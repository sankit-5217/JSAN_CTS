import { randomUUID } from "node:crypto";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import type { AlertSeverity } from "../alerts/alerts.constants";
import { AlertsService } from "../alerts/alerts.service";
import { AuditService } from "../audit/audit.service";
import { HealthSnapshotDto } from "./dto/health-snapshot.dto";
import {
  ComponentAlertPlan,
  ComponentAlertRaise,
  ComponentAlertRecover,
  HARDWARE_ROLLUP_ALERT_TYPE,
  parseOpenAlerts,
  planComponentAlerts,
} from "./hardware-alerts";

export interface RecordedSnapshot {
  ciCode: string;
  ciId: string;
  overallHealth: string;
  degradedCount: number;
}

export interface RejectedSnapshot {
  index: number;
  ciCode: string;
  reason: string;
}

export interface RecordSnapshotsResult {
  accepted: RecordedSnapshot[];
  rejected: RejectedSnapshot[];
}

/**
 * Owns: the current `HealthSnapshot` per CI — the normalized rollup the hardware
 * adapters (`integrations/redfish`, `dell-ome`, `hpe-ilo`) produce and the site
 * collector delivers. Only the compact snapshot lands here; per-sensor telemetry
 * stays in the monitoring platform (CLAUDE.md).
 *
 * NOTE: `HealthSnapshot` relates 1:1 to a ConfigurationItem. If Dev A decides
 * that record is cmdb's to write, this upsert moves behind a
 * `CmdbService.upsertHealthSnapshot()` call — the ingest contract here stays.
 */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly alerts: AlertsService,
  ) {}

  /** Upsert a batch of snapshots. An unknown CI is rejected per-item, not fatal. */
  async recordSnapshots(
    snapshots: HealthSnapshotDto[],
    actor: ActorContext,
  ): Promise<RecordSnapshotsResult> {
    const accepted: RecordedSnapshot[] = [];
    const rejected: RejectedSnapshot[] = [];

    for (const [index, snap] of snapshots.entries()) {
      const ci = await this.prisma.configurationItem.findUnique({
        where: { ciCode: snap.ciCode },
      });
      if (!ci) {
        rejected.push({ index, ciCode: snap.ciCode, reason: "unknown CI" });
        continue;
      }

      const { ciCode, observedAt, ...rest } = snap;
      // strip undefined-valued keys so it is a clean JSON value for the Json column
      const details = JSON.parse(JSON.stringify(rest)) as Prisma.InputJsonValue;
      const degradedCount = snap.degraded?.length ?? 0;

      const existing = await this.prisma.healthSnapshot.findUnique({ where: { ciId: ci.id } });
      // Per-component alerts (hardware-alerts.ts). UNKNOWN/MAINTENANCE readings
      // carry every open alert forward untouched; a degraded drive/PSU/fan
      // opens or updates its own alert and recovers when that part is healthy.
      const plan = planComponentAlerts(parseOpenAlerts(existing?.openAlerts), snap, randomUUID);
      // A rollup alert left open from before per-component alerts existed is
      // closed on the first decisive (non-UNKNOWN/MAINTENANCE) reading; any
      // still-failing part has just been raised as its own alert above.
      const legacyEventId =
        existing?.openAlertEventId &&
        (snap.overallHealth === "HEALTHY" || plan.raise.length > 0 || plan.recover.length > 0)
          ? existing.openAlertEventId
          : null;
      const openAlerts = plan.next as unknown as Prisma.InputJsonValue;
      const openAlertEventId = legacyEventId ? null : (existing?.openAlertEventId ?? null);

      // Audit only what changed (overall health, or a component alert opening
      // or closing): the collector polls every ~30 s, and an audit row per
      // unchanged poll is telemetry in the audit trail (CLAUDE.md).
      const changed =
        !existing ||
        existing.overallHealth !== snap.overallHealth ||
        plan.raise.length > 0 ||
        plan.recover.length > 0;

      const persisted = await this.prisma.$transaction(async (tx) => {
        const row = await tx.healthSnapshot.upsert({
          where: { ciId: ci.id },
          create: {
            ciId: ci.id,
            overallHealth: snap.overallHealth,
            details,
            lastHeartbeatAt: new Date(observedAt),
            openAlerts,
          },
          update: {
            overallHealth: snap.overallHealth,
            details,
            lastHeartbeatAt: new Date(observedAt),
            openAlerts,
            openAlertEventId,
          },
        });
        if (changed) await this.audit.record(
          {
            actorId: actor.actorId,
            correlationId: actor.correlationId,
            entityType: "health_snapshot",
            entityId: row.id,
            action: "HEALTH_SNAPSHOT_RECORDED",
            after: {
              ciCode,
              source: snap.source,
              overallHealth: snap.overallHealth,
              powerState: snap.powerState,
              degradedCount,
              predictiveFailures: snap.predictiveFailures?.length ?? 0,
            },
          },
          tx,
        );
        return row;
      });

      // Best-effort — a failure turning a health reading into an alert must
      // never fail the health-snapshot write itself (same posture as the
      // maintenance-window check in AlertsService.isCiUnderMaintenance).
      await this.syncComponentAlerts(ci, snap, plan, legacyEventId, actor);

      accepted.push({
        ciCode,
        ciId: ci.id,
        overallHealth: persisted.overallHealth,
        degradedCount,
      });
    }

    return { accepted, rejected };
  }

  private async syncComponentAlerts(
    ci: { id: string; ciCode: string; siteId: string },
    snap: HealthSnapshotDto,
    plan: ComponentAlertPlan,
    legacyEventId: string | null,
    actor: ActorContext,
  ): Promise<void> {
    const siteCode = await this.resolveSiteCode(ci.siteId);
    const recoveries: Array<
      Omit<ComponentAlertRecover, "componentKey"> & {
        componentKey: string | undefined;
      }
    > = [...plan.recover];
    if (legacyEventId) {
      recoveries.push({
        eventId: legacyEventId,
        alertType: HARDWARE_ROLLUP_ALERT_TYPE,
        componentKey: undefined,
      });
    }
    for (const raise of plan.raise) {
      await this.bestEffort(ci.ciCode, () =>
        this.raiseComponentAlert(ci, siteCode, snap, raise, actor),
      );
    }
    for (const rec of recoveries) {
      await this.bestEffort(ci.ciCode, () =>
        this.recoverComponentAlert(ci, siteCode, snap, rec, actor),
      );
    }
  }

  private async bestEffort(ciCode: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(
        `hardware-health alert sync for CI ${ciCode} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async resolveSiteCode(siteId: string): Promise<string> {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    return site?.code ?? "UNKNOWN";
  }

  /** Opens a component's alert on first sighting, or re-ingests under the same
   *  eventId on every later bad poll so the same row picks up the latest
   *  severity/summary. Mirrors how Alertmanager re-delivers a firing alert. */
  private async raiseComponentAlert(
    ci: { ciCode: string },
    siteCode: string,
    snap: HealthSnapshotDto,
    raise: ComponentAlertRaise,
    actor: ActorContext,
  ): Promise<void> {
    await this.alerts.ingest(
      {
        eventId: raise.eventId,
        source: "REDFISH",
        siteCode,
        ciCode: ci.ciCode,
        alertType: raise.alertType,
        componentKey: raise.componentKey,
        severity: raise.severity,
        occurredAt: snap.observedAt,
        state: "OPEN",
        summary: raise.summary,
        attributes: raise.attributes,
      },
      actor,
    );
  }

  /** Closes a component's alert once that part reads healthy — same eventId,
   *  so it resolves the same row. Keeps the severity it was last raised at
   *  (same convention as the Prometheus/Zabbix/SNMP adapters: a resolved
   *  CRITICAL stays CRITICAL, just RECOVERED). */
  private async recoverComponentAlert(
    ci: { ciCode: string },
    siteCode: string,
    snap: HealthSnapshotDto,
    rec: { eventId: string; alertType: string; componentKey: string | undefined },
    actor: ActorContext,
  ): Promise<void> {
    const openAlert = await this.prisma.alert.findUnique({
      where: { source_externalEventId: { source: "REDFISH", externalEventId: rec.eventId } },
    });
    await this.alerts.ingest(
      {
        eventId: rec.eventId,
        source: "REDFISH",
        siteCode,
        ciCode: ci.ciCode,
        alertType: rec.alertType,
        componentKey: rec.componentKey,
        severity: (openAlert?.severity as AlertSeverity) ?? "WARNING",
        occurredAt: snap.observedAt,
        state: "RECOVERED",
        summary: rec.componentKey
          ? `${rec.componentKey} back to HEALTHY (${snap.source})`
          : `${snap.source} reports overall health back to HEALTHY`,
        attributes: { healthSnapshotSource: snap.source },
      },
      actor,
    );
  }

  /**
   * Record a site collector's liveness ping (spec §26): the latest ping per
   * site, overwritten each time, so a monitoring check can flag any site
   * whose collector has gone quiet — a silent collector must not read as
   * "everything healthy". Not an audit event: it changes nothing.
   */
  async recordHeartbeat(siteCode: string, actor: ActorContext): Promise<{ recordedAt: string }> {
    const now = new Date();
    await this.prisma.collectorHeartbeat.upsert({
      where: { siteCode },
      create: { siteCode, lastSeenAt: now, reportedById: actor.actorId },
      update: { lastSeenAt: now, reportedById: actor.actorId },
    });
    return { recordedAt: now.toISOString() };
  }

  /** Each site's last collector ping, limited to `siteIds` (null = all). */
  async listHeartbeats(siteIds: string[] | null) {
    const sites = siteIds
      ? await this.prisma.site.findMany({ where: { id: { in: siteIds } }, select: { code: true } })
      : null;
    return this.prisma.collectorHeartbeat.findMany({
      where: sites ? { siteCode: { in: sites.map((s) => s.code) } } : undefined,
      orderBy: { siteCode: "asc" },
    });
  }

  /** Current snapshot for a CI by its code. */
  /** `siteIds` null = every site; a CI on another site reads as not found. */
  async getForCi(ciCode: string, siteIds: string[] | null = null) {
    const ci = await this.prisma.configurationItem.findUnique({ where: { ciCode } });
    if (!ci || (siteIds && !siteIds.includes(ci.siteId))) {
      throw new NotFoundException(`Configuration item ${ciCode} not found`);
    }
    const snapshot = await this.prisma.healthSnapshot.findUnique({ where: { ciId: ci.id } });
    if (!snapshot) {
      throw new NotFoundException(`No health snapshot recorded for ${ciCode}`);
    }
    return snapshot;
  }
}
