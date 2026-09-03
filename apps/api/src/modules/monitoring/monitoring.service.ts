import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import { HealthSnapshotDto } from "./dto/health-snapshot.dto";

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
      const persisted = await this.prisma.$transaction(async (tx) => {
        const row = await tx.healthSnapshot.upsert({
          where: { ciId: ci.id },
          create: {
            ciId: ci.id,
            overallHealth: snap.overallHealth,
            details,
            lastHeartbeatAt: new Date(observedAt),
          },
          update: {
            overallHealth: snap.overallHealth,
            details,
            lastHeartbeatAt: new Date(observedAt),
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

      accepted.push({
        ciCode,
        ciId: ci.id,
        overallHealth: persisted.overallHealth,
        degradedCount,
      });
    }

    return { accepted, rejected };
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
