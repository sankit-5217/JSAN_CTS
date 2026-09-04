import { Inject, Injectable, Logger } from "@nestjs/common";
import { WarrantyStatus } from "@prisma/client";
import { resolveWarrantyProvider } from "@cts-dc-opsdesk/warranty-adapter";
import type { WarrantyLookupResult, WarrantyProvider } from "@cts-dc-opsdesk/warranty-adapter";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import { WARRANTY_PROVIDERS } from "./warranty.providers";

/** One CI that could not be resynced, with a human reason. */
export interface WarrantyResyncItemNote {
  ciCode: string;
  reason: string;
}

export interface WarrantyResyncSummary {
  /** CIs considered (had a service tag, matched the id filter if any). */
  checked: number;
  /** New `Warranty` rows appended because coverage changed. */
  updated: number;
  /** Coverage identical to the latest row — nothing written. */
  unchanged: number;
  /** No provider for the CI's manufacturer, or the CI lacked a manufacturer. */
  skipped: WarrantyResyncItemNote[];
  /** Provider lookup threw — the batch continues. */
  failed: WarrantyResyncItemNote[];
}

/** null/null -> true; one null -> false; otherwise same millisecond. */
function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return a.getTime() === b.getTime();
}

function toWarrantyStatus(state: WarrantyLookupResult["status"]): WarrantyStatus {
  // The adapter's WarrantyState is defined to match this enum 1:1; guard drift.
  return WarrantyStatus[state];
}

/**
 * Refreshes hardware warranty coverage for CIs from the configured providers
 * (spec §10.13). Owned by the `vendors` module — it is the only writer of the
 * `Warranty` table. The table is append-only (no unique on ci, no updatedAt):
 * the newest row per CI is the current state, and a change appends a new row
 * with a `WARRANTY_REFRESHED` audit event in the same transaction. Read-only
 * against everything else — it never touches the CI record itself.
 */
@Injectable()
export class WarrantyResyncService {
  private readonly logger = new Logger(WarrantyResyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(WARRANTY_PROVIDERS) private readonly providers: WarrantyProvider[],
  ) {}

  async run(actor: ActorContext, opts: { ciIds?: string[] } = {}): Promise<WarrantyResyncSummary> {
    const cis = await this.prisma.configurationItem.findMany({
      where: {
        serialOrServiceTag: { not: null },
        ...(opts.ciIds && opts.ciIds.length > 0 ? { id: { in: opts.ciIds } } : {}),
      },
      select: { id: true, ciCode: true, manufacturer: true, serialOrServiceTag: true },
    });

    const summary: WarrantyResyncSummary = {
      checked: cis.length,
      updated: 0,
      unchanged: 0,
      skipped: [],
      failed: [],
    };

    for (const ci of cis) {
      const vendor = (ci.manufacturer ?? "").trim();
      const serialOrServiceTag = (ci.serialOrServiceTag ?? "").trim();
      if (!vendor || !serialOrServiceTag) {
        summary.skipped.push({
          ciCode: ci.ciCode,
          reason: "CI has no manufacturer or service tag",
        });
        continue;
      }

      const provider = resolveWarrantyProvider(this.providers, vendor);
      if (!provider) {
        summary.skipped.push({ ciCode: ci.ciCode, reason: `no warranty provider for "${vendor}"` });
        continue;
      }

      let result: WarrantyLookupResult;
      try {
        result = await provider.lookup({ vendor, serialOrServiceTag });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        summary.failed.push({ ciCode: ci.ciCode, reason });
        this.logger.warn(`warranty lookup failed for ${ci.ciCode}: ${reason}`);
        continue;
      }

      const status = toWarrantyStatus(result.status);
      const expiresAt = result.expiresAt ? new Date(result.expiresAt) : null;
      const providerName = result.provider;

      const latest = await this.prisma.warranty.findFirst({
        where: { ciId: ci.id },
        orderBy: { createdAt: "desc" },
      });

      if (
        latest &&
        latest.status === status &&
        (latest.provider ?? null) === providerName &&
        sameInstant(latest.expiresAt, expiresAt)
      ) {
        summary.unchanged += 1;
        continue;
      }

      await this.prisma.$transaction(async (tx) => {
        const created = await tx.warranty.create({
          data: { ciId: ci.id, status, provider: providerName, expiresAt },
        });
        await this.audit.record(
          {
            actorId: actor.actorId,
            correlationId: actor.correlationId,
            entityType: "warranty",
            entityId: ci.id,
            action: "WARRANTY_REFRESHED",
            before: latest ?? undefined,
            after: created,
          },
          tx,
        );
      });
      summary.updated += 1;
    }

    this.logger.log(
      `warranty resync by ${actor.actorId}: checked ${summary.checked}, updated ${summary.updated}, ` +
        `unchanged ${summary.unchanged}, skipped ${summary.skipped.length}, failed ${summary.failed.length}`,
    );
    return summary;
  }
}
