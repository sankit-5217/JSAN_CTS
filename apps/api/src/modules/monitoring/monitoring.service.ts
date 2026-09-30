import { randomUUID } from "node:crypto";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import type { AlertSeverity } from "../alerts/alerts.constants";
import { AlertsService } from "../alerts/alerts.service";
import { AuditService } from "../audit/audit.service";
import { HealthSnapshotDto } from "./dto/health-snapshot.dto";

export interface RecordedSnapshot {
  ciCode: string;
  ciId: string;
  overallHealth: string;
  degradedCount: number;
}

/** overallHealth values that represent a real, alertable degradation. */
const BAD_HEALTH_STATES: readonly string[] = ["WARNING", "CRITICAL"];
const HEALTH_TO_ALERT_SEVERITY: Record<string, AlertSeverity> = {
  CRITICAL: "CRITICAL",
  WARNING: "WARNING",
};
const HARDWARE_ALERT_TYPE = "hardware.health_degraded";

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
      const isBad = BAD_HEALTH_STATES.includes(snap.overallHealth);
      // UNKNOWN/MAINTENANCE readings carry an open episode forward untouched
      // (a BMC connectivity blip or a planned maintenance window shouldn't
      // itself open or falsely recover a hardware alert); only a genuine
      // WARNING/CRITICAL opens one and only HEALTHY closes it.
      const nextOpenAlertEventId = isBad
        ? (existing?.openAlertEventId ?? randomUUID())
        : snap.overallHealth === "HEALTHY"
          ? null
          : (existing?.openAlertEventId ?? null);

      const persisted = await this.prisma.$transaction(async (tx) => {
        const row = await tx.healthSnapshot.upsert({
          where: { ciId: ci.id },
          create: {
            ciId: ci.id,
            overallHealth: snap.overallHealth,
            details,
            lastHeartbeatAt: new Date(observedAt),
            openAlertEventId: nextOpenAlertEventId,
          },
          update: {
            overallHealth: snap.overallHealth,
            details,
            lastHeartbeatAt: new Date(observedAt),
            openAlertEventId: nextOpenAlertEventId,
          },
        });
        await this.audit.record(
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
      try {
        if (isBad) {
          await this.raiseOrUpdateHealthAlert(ci, snap, nextOpenAlertEventId as string, actor);
        } else if (snap.overallHealth === "HEALTHY" && existing?.openAlertEventId) {
          await this.recoverHealthAlert(ci, snap, existing.openAlertEventId, actor);
        }
      } catch (err) {
        this.logger.warn(
          `hardware-health alert sync for CI ${ciCode} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      accepted.push({
        ciCode,
        ciId: ci.id,
        overallHealth: persisted.overallHealth,
        degradedCount,
      });
    }

    return { accepted, rejected };
  }

  /** Human-readable line for the alert's summary — the degraded component list
   *  when the source provided one, a generic fallback otherwise. */
  private summarizeDegraded(snap: HealthSnapshotDto): string {
    if (snap.degraded.length > 0) {
      return snap.degraded.map((d) => `${d.kind} ${d.name} (${d.health})`).join(", ");
    }
    return `${snap.source} reports overall health ${snap.overallHealth}`;
  }

  private async resolveSiteCode(siteId: string): Promise<string> {
    const site = await this.prisma.site.findUnique({ where: { id: siteId } });
    return site?.code ?? "UNKNOWN";
  }

  /** Opens a new hardware-health alert on first sighting of a bad reading, or
   *  re-ingests under the same eventId on every subsequent bad poll so the same
   *  alert row picks up the latest severity/summary instead of piling up
   *  duplicates. Mirrors how Alertmanager keeps re-delivering a firing alert. */
  private async raiseOrUpdateHealthAlert(
    ci: { id: string; ciCode: string; siteId: string },
    snap: HealthSnapshotDto,
    eventId: string,
    actor: ActorContext,
  ): Promise<void> {
    const siteCode = await this.resolveSiteCode(ci.siteId);
    await this.alerts.ingest(
      {
        eventId,
        source: "REDFISH",
        siteCode,
        ciCode: ci.ciCode,
        alertType: HARDWARE_ALERT_TYPE,
        severity: HEALTH_TO_ALERT_SEVERITY[snap.overallHealth] ?? "WARNING",
        occurredAt: snap.observedAt,
        state: "OPEN",
        summary: this.summarizeDegraded(snap),
        attributes: {
          healthSnapshotSource: snap.source,
          overallHealth: snap.overallHealth,
          degraded: snap.degraded,
          predictiveFailures: snap.predictiveFailures,
        },
      },
      actor,
    );
  }

  /** Closes the hardware-health alert this CI's bad streak opened, the moment a
   *  poll reports HEALTHY again — same eventId, so it resolves the same alert
   *  row instead of creating a new one. Keeps whatever severity the alert was
   *  last raised/updated at (same convention as the Prometheus/Zabbix/SNMP
   *  adapters: a resolved CRITICAL stays CRITICAL, just RECOVERED) rather than
   *  downgrading it, since severity records what the condition *was*. */
  private async recoverHealthAlert(
    ci: { id: string; ciCode: string; siteId: string },
    snap: HealthSnapshotDto,
    eventId: string,
    actor: ActorContext,
  ): Promise<void> {
    const siteCode = await this.resolveSiteCode(ci.siteId);
    const openAlert = await this.prisma.alert.findUnique({
      where: { source_externalEventId: { source: "REDFISH", externalEventId: eventId } },
    });
    await this.alerts.ingest(
      {
        eventId,
        source: "REDFISH",
        siteCode,
        ciCode: ci.ciCode,
        alertType: HARDWARE_ALERT_TYPE,
        severity: (openAlert?.severity as AlertSeverity) ?? "WARNING",
        occurredAt: snap.observedAt,
        state: "RECOVERED",
        summary: `${snap.source} reports overall health back to HEALTHY`,
        attributes: { healthSnapshotSource: snap.source },
      },
      actor,
    );
  }

  /**
   * Record a site collector's liveness ping (spec §26). Written as an
   * append-only audit event (entityType "collector", entityId the site code) so
   * a monitoring check / report can flag any site whose last COLLECTOR_HEARTBEAT
   * is stale — a silent collector must not read as "everything healthy".
   */
  async recordHeartbeat(siteCode: string, actor: ActorContext): Promise<{ recordedAt: string }> {
    const recordedAt = new Date().toISOString();
    await this.audit.record({
      actorId: actor.actorId,
      correlationId: actor.correlationId,
      entityType: "collector",
      entityId: siteCode,
      action: "COLLECTOR_HEARTBEAT",
      after: { recordedAt },
    });
    return { recordedAt };
  }

  /** Current snapshot for a CI by its code. */
  async getForCi(ciCode: string) {
    const ci = await this.prisma.configurationItem.findUnique({ where: { ciCode } });
    if (!ci) {
      throw new NotFoundException(`Configuration item ${ciCode} not found`);
    }
    const snapshot = await this.prisma.healthSnapshot.findUnique({ where: { ciId: ci.id } });
    if (!snapshot) {
      throw new NotFoundException(`No health snapshot recorded for ${ciCode}`);
    }
    return snapshot;
  }
}
