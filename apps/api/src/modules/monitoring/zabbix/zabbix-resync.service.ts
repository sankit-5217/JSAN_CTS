import { HttpException, Injectable, Logger, Optional } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { ZabbixWebhookEvent } from "@cts-dc-opsdesk/zabbix-adapter";
import { JobLockService } from "../../../common/prisma/job-lock.service";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { ActorContext } from "../../../common/types/actor-context.type";
import { AlertsService } from "../../alerts/alerts.service";
import { ZabbixWebhookEventDto } from "../../alerts/dto/zabbix-webhook.dto";
import { RawProblem, RawHost, RawTag, ZabbixService } from "./zabbix.service";

/** The webhook adapter's external-id prefix (integrations/zabbix normalize.ts). */
const ZABBIX_ID_PREFIX = "zbx-";
/** An alert this young may still have its webhook in flight; leave it alone. */
const GRACE_MS = 2 * 60_000;
/**
 * Refuse to recover more than this share of open alerts in one pass: an
 * empty or partial answer from Zabbix (a token that lost permissions, a
 * host group moved) must not clear the whole alert queue.
 */
const MAX_RECOVER_SHARE = 0.5;
/** ...unless the absolute number is this small. */
const MAX_RECOVER_ALWAYS_OK = 20;

export interface ResyncResult {
  skipped?: string;
  zabbixOpen: number;
  created: number;
  acknowledged: number;
  recovered: number;
  /** Stale alerts left alone (safety cap, or details too thin to replay). */
  held: number;
}

/**
 * Keeps OpsDesk's Zabbix alerts in step with Zabbix itself, so nothing is
 * lost when a webhook delivery is (OpsDesk down for a deploy, a network
 * blip, Zabbix giving up after its retries):
 *
 * - a problem open in Zabbix with no OpsDesk alert is created;
 * - an acknowledgement made in Zabbix reaches the OpsDesk alert;
 * - an OpsDesk alert whose problem Zabbix has resolved is recovered.
 *
 * Every change goes through AlertsService.ingestFromZabbix — the same
 * normalization, dedupe (by event id), alert rules, auto-ticketing,
 * incident linking and audit as the webhook. The webhook stays the fast
 * path; this is the safety net, every 2 minutes, on one instance at a time.
 *
 * It acts as the admin who configured the Zabbix integration (the last
 * actor on its settings), tagged with correlation id "zabbix-resync".
 */
@Injectable()
export class ZabbixResyncService {
  private readonly logger = new Logger(ZabbixResyncService.name);

  constructor(
    private readonly zabbix: ZabbixService,
    private readonly alerts: AlertsService,
    private readonly prisma: PrismaService,
    @Optional() private readonly jobLock?: JobLockService,
  ) {}

  @Cron("*/2 * * * *")
  async scheduledResync(): Promise<void> {
    if (process.env.ZABBIX_RESYNC === "off") return;
    const run = () => this.resync();
    await (this.jobLock ? this.jobLock.runExclusive("zabbix-resync", run) : run());
  }

  async resync(now: Date = new Date()): Promise<ResyncResult> {
    const result: ResyncResult = {
      zabbixOpen: 0,
      created: 0,
      acknowledged: 0,
      recovered: 0,
      held: 0,
    };

    let open: { problem: RawProblem; host: RawHost }[];
    try {
      open = await this.zabbix.openProblemsForResync();
    } catch (err) {
      // Not configured / switched off is normal; anything else is worth a line.
      const code =
        err instanceof HttpException
          ? ((err.getResponse() as { code?: string })?.code ?? err.message)
          : String(err);
      if (code !== "ZABBIX_NOT_CONFIGURED" && code !== "ZABBIX_DISABLED") {
        this.logger.warn(`Zabbix re-sync skipped: could not read problems (${code})`);
      }
      return { ...result, skipped: code };
    }
    result.zabbixOpen = open.length;

    const actor = await this.actor();
    if (!actor) {
      this.logger.warn("Zabbix re-sync skipped: no admin has saved the Zabbix settings yet");
      return { ...result, skipped: "NO_ACTOR" };
    }

    // 1. Problems OpsDesk is missing, and acknowledgements it hasn't seen.
    const events = open.map(({ problem, host }) => toProblemEvent(problem, host));
    const states = await this.alerts.statesByExternalId(
      "ZABBIX",
      events.map((e) => ZABBIX_ID_PREFIX + e.eventId),
    );
    const missing = events.filter((e) => !states.has(ZABBIX_ID_PREFIX + e.eventId));
    const ackDrift = events.filter(
      (e) => e.eventAckStatus === "Yes" && states.get(ZABBIX_ID_PREFIX + e.eventId) === "OPEN",
    );
    if (missing.length > 0) {
      const r = await this.alerts.ingestFromZabbix(missing, actor);
      result.created = r.accepted.length;
    }
    if (ackDrift.length > 0) {
      const r = await this.alerts.ingestFromZabbix(ackDrift, actor);
      result.acknowledged = r.accepted.length;
    }

    // 2. Alerts still open in OpsDesk that Zabbix has resolved.
    const openInZabbix = new Set(events.map((e) => ZABBIX_ID_PREFIX + e.eventId));
    const stale = (
      await this.alerts.openFromSource("ZABBIX", new Date(now.getTime() - GRACE_MS))
    ).filter((a) => !openInZabbix.has(a.externalEventId));
    const openCount = states.size + stale.length;
    if (
      stale.length > MAX_RECOVER_ALWAYS_OK &&
      stale.length > Math.ceil(openCount * MAX_RECOVER_SHARE)
    ) {
      this.logger.error(
        `Zabbix re-sync: ${stale.length} open alerts are not open in Zabbix — more than the safety ` +
          `cap, so none were recovered. Check the Zabbix API token's host permissions.`,
      );
      result.held = stale.length;
    } else {
      const recoveries: ZabbixWebhookEventDto[] = [];
      for (const alert of stale) {
        const event = toRecoveryEvent(alert, now);
        if (event) recoveries.push(event);
        else result.held += 1;
      }
      if (recoveries.length > 0) {
        const r = await this.alerts.ingestFromZabbix(recoveries, actor);
        result.recovered = r.accepted.length;
        result.held += r.rejected.length;
      }
    }

    if (result.created + result.acknowledged + result.recovered + result.held > 0) {
      this.logger.log(
        `Zabbix re-sync: ${result.created} created, ${result.acknowledged} acknowledged, ` +
          `${result.recovered} recovered, ${result.held} left for review (${result.zabbixOpen} open in Zabbix)`,
      );
    }
    return result;
  }

  /** The admin who last saved the Zabbix settings (audited), as the acting user. */
  private async actor(): Promise<ActorContext | null> {
    const last = await this.prisma.auditEvent.findFirst({
      where: { entityType: "ZabbixConnection", actorId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { actorId: true },
    });
    return last?.actorId ? { actorId: last.actorId, correlationId: "zabbix-resync" } : null;
  }
}

function tagsObject(tags: RawTag[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tags ?? []) out[t.tag] = t.value;
  return out;
}

/** An open Zabbix problem as the webhook would have delivered it. */
export function toProblemEvent(problem: RawProblem, host: RawHost): ZabbixWebhookEventDto {
  const event: ZabbixWebhookEvent = {
    eventId: problem.eventid,
    eventValue: "1",
    eventAckStatus: problem.acknowledged === "1" ? "Yes" : "No",
    name: problem.name,
    nseverity: problem.severity,
    timestamp: problem.clock,
    host: host.host,
    hostName: host.name,
    triggerId: problem.objectid,
    ...(problem.opdata ? { opdata: problem.opdata } : {}),
    tags: tagsObject(problem.tags),
  };
  return event as ZabbixWebhookEventDto;
}

/**
 * The recovery the webhook would have sent for an OpsDesk alert, rebuilt
 * from the Zabbix metadata stored on it (the adapter's attributes). Null
 * when that metadata is missing or was truncated, so it can't be replayed
 * faithfully.
 */
export function toRecoveryEvent(
  alert: { externalEventId: string; summary: string | null; details: unknown },
  now: Date,
): ZabbixWebhookEventDto | null {
  const d = (alert.details ?? {}) as Record<string, unknown>;
  const zabbixEventId =
    typeof d.zabbixEventId === "string"
      ? d.zabbixEventId
      : alert.externalEventId.startsWith(ZABBIX_ID_PREFIX)
        ? alert.externalEventId.slice(ZABBIX_ID_PREFIX.length)
        : null;
  const host = typeof d.host === "string" ? d.host : null;
  if (!zabbixEventId || !host || d.truncated) return null;
  const tags =
    d.tags && typeof d.tags === "object" ? (d.tags as Record<string, string>) : undefined;
  const event: ZabbixWebhookEvent = {
    eventId: zabbixEventId,
    eventValue: "0",
    name: (alert.summary ?? "Resolved in Zabbix").slice(0, 500),
    timestamp: String(Math.floor(now.getTime() / 1000)),
    host,
    ...(typeof d.hostName === "string" ? { hostName: d.hostName } : {}),
    ...(typeof d.itemKey === "string" ? { itemKey: d.itemKey } : {}),
    ...(typeof d.triggerId === "string" ? { triggerId: d.triggerId } : {}),
    ...(typeof d.zabbixNSeverity === "string" ? { nseverity: d.zabbixNSeverity } : {}),
    ...(tags ? { tags } : {}),
  };
  return event as ZabbixWebhookEventDto;
}
