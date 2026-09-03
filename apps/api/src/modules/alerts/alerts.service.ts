import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { normalizeAlertmanagerWebhook } from "@cts-dc-opsdesk/prometheus-adapter";
import { normalizeSnmpTrap, SnmpNormalizationError } from "@cts-dc-opsdesk/snmp-adapter";
import {
  AlertNormalizationError as ZabbixNormalizationError,
  normalizeZabbixEvent,
} from "@cts-dc-opsdesk/zabbix-adapter";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import type { AlertState } from "./alerts.constants";
import { computeAlertFingerprint } from "./alerts.fingerprint";
import { AlertmanagerWebhookDto } from "./dto/alertmanager-webhook.dto";
import { IngestAlertDto } from "./dto/ingest-alert.dto";
import { QueryAlertsDto } from "./dto/query-alerts.dto";
import { SnmpTrapDto } from "./dto/snmp-trap.dto";
import { ZabbixWebhookEventDto } from "./dto/zabbix-webhook.dto";

/** Outcome of an ingestion call. Safe to return to the calling adapter/collector. */
export interface AlertIngestResult {
  alertId: string;
  fingerprint: string;
  /** true when the payload matched an existing (source, externalEventId) row. */
  deduped: boolean;
  /** true when this call moved the alert between OPEN / ACKNOWLEDGED / RECOVERED. */
  stateChanged: boolean;
  siteResolved: boolean;
  ciResolved: boolean;
  /** same fingerprint seen at least `flappingThreshold` times in the recent window. */
  flapping: boolean;
  recentOccurrences: number;
  /**
   * The linked CI is in MAINTENANCE lifecycle — the alert is still recorded, but
   * downstream correlation should annotate rather than raise an incident. Broader
   * change-window suppression is layered on by the worker via the changes module.
   */
  suppressedByMaintenance: boolean;
}

/** One alert rejected during source-specific normalization. */
export interface RejectedAlert {
  index: number;
  field?: string;
  message: string;
}

/** Outcome of a source webhook: what was normalized + ingested, and what wasn't. */
export interface SourceIngestResult {
  accepted: AlertIngestResult[];
  rejected: RejectedAlert[];
}

const DEFAULT_FLAPPING_THRESHOLD = 3;
const DEFAULT_FLAPPING_WINDOW_MINUTES = 30;

/**
 * Owns: normalized alerts, fingerprints, dedup, flapping signal (spec §10.9-10.10).
 * Must not own: raw time-series storage (that stays in Zabbix/Prometheus), and
 * must not mutate incident/SLA tables directly — correlation goes through the
 * incidents service once it lands.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly flappingThreshold: number;
  private readonly flappingWindowMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    // config-over-hardcode stopgap: env-driven until the alert_rules table
    // (Dev B, spec §10.10) provides per-site / per-type thresholds.
    this.flappingThreshold = toPositiveInt(
      process.env.ALERTS_FLAPPING_THRESHOLD,
      DEFAULT_FLAPPING_THRESHOLD,
    );
    this.flappingWindowMinutes = toPositiveInt(
      process.env.ALERTS_FLAPPING_WINDOW_MINUTES,
      DEFAULT_FLAPPING_WINDOW_MINUTES,
    );
  }

  async ingest(dto: IngestAlertDto, actor: ActorContext): Promise<AlertIngestResult> {
    const occurredAt = new Date(dto.occurredAt);

    const site = await this.prisma.site.findUnique({ where: { code: dto.siteCode } });
    const ci = await this.prisma.configurationItem.findUnique({ where: { ciCode: dto.ciCode } });

    if (!site) {
      this.logger.warn(
        `Alert ${dto.source}:${dto.eventId} references unknown site "${dto.siteCode}" — stored unresolved`,
      );
    }
    if (!ci) {
      this.logger.warn(
        `Alert ${dto.source}:${dto.eventId} references unknown CI "${dto.ciCode}" — stored unresolved`,
      );
    }

    const fingerprint = computeAlertFingerprint({
      siteCode: dto.siteCode,
      ciCode: dto.ciCode,
      alertType: dto.alertType,
      componentKey: dto.componentKey,
    });

    const existing = await this.prisma.alert.findUnique({
      where: {
        source_externalEventId: { source: dto.source, externalEventId: dto.eventId },
      },
    });

    let alertId: string;
    let deduped: boolean;
    let stateChanged: boolean;

    if (existing) {
      const nextState = reduceAlertState(existing.state as AlertState, dto.state);
      deduped = true;
      stateChanged = nextState !== existing.state;
      const updateData = {
        severity: dto.severity,
        state: nextState,
        lastSeenAt:
          occurredAt.getTime() > existing.lastSeenAt.getTime() ? occurredAt : existing.lastSeenAt,
        // backfill references if the site / CI became known since first sighting
        siteId: existing.siteId ?? site?.id ?? null,
        ciId: existing.ciId ?? ci?.id ?? null,
      };

      if (stateChanged) {
        // A lifecycle move is auditable; a plain dedup / lastSeenAt bump is not
        // (ingestion is high-volume — only state changes earn an audit row).
        const updated = await this.prisma.$transaction(async (tx) => {
          const u = await tx.alert.update({ where: { id: existing.id }, data: updateData });
          await this.audit.record(
            {
              actorId: actor.actorId,
              correlationId: actor.correlationId,
              entityType: "alert",
              entityId: existing.id,
              action: "ALERT_STATE_CHANGED",
              before: { state: existing.state, severity: existing.severity },
              after: { state: u.state, severity: u.severity },
            },
            tx,
          );
          return u;
        });
        alertId = updated.id;
      } else {
        const updated = await this.prisma.alert.update({
          where: { id: existing.id },
          data: updateData,
        });
        alertId = updated.id;
      }
    } else {
      deduped = false;
      stateChanged = true;
      const created = await this.prisma.$transaction(async (tx) => {
        const c = await tx.alert.create({
          data: {
            externalEventId: dto.eventId,
            source: dto.source,
            siteId: site?.id ?? null,
            ciId: ci?.id ?? null,
            alertType: dto.alertType,
            severity: dto.severity,
            fingerprint,
            firstSeenAt: occurredAt,
            lastSeenAt: occurredAt,
            state: dto.state,
            rawReference: extractRawReference(dto.attributes),
          },
        });
        await this.audit.record(
          {
            actorId: actor.actorId,
            correlationId: actor.correlationId,
            entityType: "alert",
            entityId: c.id,
            action: "ALERT_RAISED",
            after: {
              source: c.source,
              externalEventId: c.externalEventId,
              fingerprint,
              state: c.state,
              severity: c.severity,
              siteId: c.siteId,
              ciId: c.ciId,
            },
          },
          tx,
        );
        return c;
      });
      alertId = created.id;
    }

    const since = new Date(Date.now() - this.flappingWindowMinutes * 60_000);
    const recentOccurrences = await this.prisma.alert.count({
      where: { fingerprint, lastSeenAt: { gte: since } },
    });

    return {
      alertId,
      fingerprint,
      deduped,
      stateChanged,
      siteResolved: Boolean(site),
      ciResolved: Boolean(ci),
      flapping: recentOccurrences >= this.flappingThreshold,
      recentOccurrences,
      suppressedByMaintenance: ci?.lifecycleStatus === "MAINTENANCE",
    };
  }

  /**
   * Ingest a batch of raw Zabbix webhook events: normalize each via the Zabbix
   * adapter, then run it through {@link ingest} (idempotent + deduped). Events
   * that fail normalization are reported in `rejected`, not thrown — one bad
   * event must not drop the batch.
   */
  async ingestFromZabbix(
    events: ZabbixWebhookEventDto[],
    actor: ActorContext,
  ): Promise<SourceIngestResult> {
    const accepted: AlertIngestResult[] = [];
    const rejected: RejectedAlert[] = [];

    for (const [index, event] of events.entries()) {
      let normalized: ReturnType<typeof normalizeZabbixEvent>;
      try {
        normalized = normalizeZabbixEvent(event);
      } catch (err) {
        rejected.push(toRejectedAlert(index, err));
        continue;
      }
      accepted.push(await this.ingest(normalized, actor));
    }

    if (rejected.length > 0) {
      this.logger.warn(`Zabbix batch: ${accepted.length} accepted, ${rejected.length} rejected`);
    }
    return { accepted, rejected };
  }

  /**
   * Ingest a Prometheus Alertmanager webhook delivery: normalize every alert via
   * the Prometheus adapter (per-alert failures collected, not fatal), then run
   * each through {@link ingest}.
   */
  async ingestFromAlertmanager(
    payload: AlertmanagerWebhookDto,
    actor: ActorContext,
  ): Promise<SourceIngestResult> {
    const { normalized, errors } = normalizeAlertmanagerWebhook(payload);

    const accepted: AlertIngestResult[] = [];
    for (const alert of normalized) {
      accepted.push(await this.ingest(alert, actor));
    }

    const rejected: RejectedAlert[] = errors.map((err) => ({
      index: err.index ?? -1,
      field: err.field,
      message: err.message,
    }));

    if (rejected.length > 0) {
      this.logger.warn(
        `Alertmanager delivery: ${accepted.length} accepted, ${rejected.length} rejected`,
      );
    }
    return { accepted, rejected };
  }

  /**
   * Ingest a batch of parsed SNMP traps from the site collector's trap receiver:
   * normalize each via the SNMP adapter, then run it through {@link ingest}.
   * Traps that fail normalization are reported in `rejected`, not thrown.
   */
  async ingestFromSnmp(traps: SnmpTrapDto[], actor: ActorContext): Promise<SourceIngestResult> {
    const accepted: AlertIngestResult[] = [];
    const rejected: RejectedAlert[] = [];

    for (const [index, trap] of traps.entries()) {
      let normalized: ReturnType<typeof normalizeSnmpTrap>;
      try {
        normalized = normalizeSnmpTrap(trap);
      } catch (err) {
        rejected.push(toRejectedAlert(index, err));
        continue;
      }
      accepted.push(await this.ingest(normalized, actor));
    }

    if (rejected.length > 0) {
      this.logger.warn(`SNMP batch: ${accepted.length} accepted, ${rejected.length} rejected`);
    }
    return { accepted, rejected };
  }

  async findAll(query: QueryAlertsDto) {
    let ciId: string | undefined;
    if (query.ciCode) {
      const ci = await this.prisma.configurationItem.findUnique({
        where: { ciCode: query.ciCode },
      });
      if (!ci) {
        return [];
      }
      ciId = ci.id;
    }

    return this.prisma.alert.findMany({
      where: {
        ...(query.state ? { state: query.state } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.fingerprint ? { fingerprint: query.fingerprint } : {}),
        ...(ciId ? { ciId } : {}),
      },
      orderBy: { lastSeenAt: "desc" },
      take: query.limit ?? 50,
    });
  }

  async findOne(id: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) {
      throw new NotFoundException(`Alert ${id} not found`);
    }
    return alert;
  }
}

/**
 * Alert lifecycle on a repeat event for the same external id. RECOVERED is
 * terminal for a given external event id — a genuinely new condition arrives
 * under a new id — and a repeated OPEN never downgrades an ACKNOWLEDGED alert.
 */
function reduceAlertState(current: AlertState, incoming: AlertState): AlertState {
  if (current === "RECOVERED") {
    return "RECOVERED";
  }
  if (incoming === "RECOVERED") {
    return "RECOVERED";
  }
  if (incoming === "ACKNOWLEDGED" && current === "OPEN") {
    return "ACKNOWLEDGED";
  }
  return current;
}

function extractRawReference(attributes: Record<string, unknown> | undefined): string | null {
  const ref = attributes?.rawReference;
  return typeof ref === "string" && ref.length > 0 ? ref : null;
}

function toRejectedAlert(index: number, err: unknown): RejectedAlert {
  if (err instanceof ZabbixNormalizationError || err instanceof SnmpNormalizationError) {
    return { index, field: err.field, message: err.message };
  }
  return { index, message: err instanceof Error ? err.message : String(err) };
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
