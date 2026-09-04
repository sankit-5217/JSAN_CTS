import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AlertRule } from "@prisma/client";
import { ActorContext } from "../../common/types/actor-context.type";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DEFAULT_ALERT_RULE } from "./alerts.constants";
import type { AlertSeverity, EffectiveAlertRule } from "./alerts.constants";
import { CreateAlertRuleDto } from "./dto/create-alert-rule.dto";
import { UpdateAlertRuleDto } from "./dto/update-alert-rule.dto";

/** How long {@link AlertRulesService.resolveRule} may serve cached rows. */
export const ALERT_RULE_CACHE_TTL_MS = 30_000;

/** What an ingest knows about itself when asking for its effective policy. */
export interface AlertRuleContext {
  siteId?: string | null;
  alertType?: string | null;
}

/**
 * Owns the `alert_rules` config table (spec §10.10 "config over hard-code"):
 * the tunables the ingestion path used to read from env / code constants —
 * flapping threshold + window, which severities page the NOC, whether a live
 * alert is auto-correlated, and maintenance suppression.
 *
 * `resolveRule()` is on the high-volume ingest path, so the active rows are
 * cached for {@link ALERT_RULE_CACHE_TTL_MS} and the most specific match is
 * picked in memory; every mutation busts the cache. With no matching row the
 * code default is served, so ingestion behaves identically before the table
 * is seeded.
 */
@Injectable()
export class AlertRulesService {
  private readonly logger = new Logger(AlertRulesService.name);
  private cache: { rules: AlertRule[]; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Effective policy for an ingest. The most specific active rule that matches
   * the alert's site and type wins — site+type beats site-only beats type-only
   * beats a global rule — and ties break to the newest. No match at all →
   * {@link DEFAULT_ALERT_RULE}.
   */
  async resolveRule(ctx: AlertRuleContext = {}): Promise<EffectiveAlertRule> {
    const siteId = ctx.siteId ?? null;
    const alertType = ctx.alertType ?? null;

    let best: AlertRule | undefined;
    let bestScore = -1;
    for (const rule of await this.activeRules()) {
      if (rule.siteId !== null && rule.siteId !== siteId) {
        continue;
      }
      if (rule.alertType !== null && rule.alertType !== alertType) {
        continue;
      }
      const score = (rule.siteId !== null ? 2 : 0) + (rule.alertType !== null ? 1 : 0);
      // activeRules() is newest-first, so a strict `>` keeps the newest of a tie.
      if (score > bestScore) {
        best = rule;
        bestScore = score;
      }
    }
    return best ? toEffectiveRule(best) : DEFAULT_ALERT_RULE;
  }

  /** Drop the cached rows so the next ingest re-reads the table. */
  invalidateCache(): void {
    this.cache = null;
  }

  private async activeRules(): Promise<AlertRule[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.rules;
    }
    const rules = await this.prisma.alertRule.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });
    this.cache = { rules, expiresAt: Date.now() + ALERT_RULE_CACHE_TTL_MS };
    return rules;
  }

  // --- CRUD (admin config, spec §10.10) --------------------------------

  list(): Promise<AlertRule[]> {
    return this.prisma.alertRule.findMany({ orderBy: { createdAt: "desc" } });
  }

  async findOne(id: string): Promise<AlertRule> {
    const rule = await this.prisma.alertRule.findUnique({ where: { id } });
    if (!rule) {
      throw new NotFoundException(`Alert rule ${id} not found`);
    }
    return rule;
  }

  async create(dto: CreateAlertRuleDto, actor: ActorContext): Promise<AlertRule> {
    const rule = await this.prisma.$transaction(async (tx) => {
      const created = await tx.alertRule.create({
        data: {
          name: dto.name,
          siteId: dto.siteId ?? null,
          alertType: dto.alertType ?? null,
          flappingThreshold: dto.flappingThreshold ?? DEFAULT_ALERT_RULE.flappingThreshold,
          flappingWindowMinutes:
            dto.flappingWindowMinutes ?? DEFAULT_ALERT_RULE.flappingWindowMinutes,
          pagingSeverities: dto.pagingSeverities ?? [...DEFAULT_ALERT_RULE.pagingSeverities],
          autoCorrelateIncidents:
            dto.autoCorrelateIncidents ?? DEFAULT_ALERT_RULE.autoCorrelateIncidents,
          suppressAutoTicketDuringMaintenance:
            dto.suppressAutoTicketDuringMaintenance ??
            DEFAULT_ALERT_RULE.suppressAutoTicketDuringMaintenance,
          isActive: dto.isActive ?? true,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "AlertRule",
          entityId: created.id,
          action: "CREATE",
          after: created,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return created;
    });
    this.invalidateCache();
    this.logger.log(`alert rule ${rule.id} ("${rule.name}") created by ${actor.actorId}`);
    return rule;
  }

  async update(id: string, dto: UpdateAlertRuleDto, actor: ActorContext): Promise<AlertRule> {
    const before = await this.findOne(id);
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.alertRule.update({
        where: { id },
        data: {
          name: dto.name,
          siteId: dto.siteId,
          alertType: dto.alertType,
          flappingThreshold: dto.flappingThreshold,
          flappingWindowMinutes: dto.flappingWindowMinutes,
          pagingSeverities: dto.pagingSeverities,
          autoCorrelateIncidents: dto.autoCorrelateIncidents,
          suppressAutoTicketDuringMaintenance: dto.suppressAutoTicketDuringMaintenance,
          isActive: dto.isActive,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "AlertRule",
          entityId: id,
          action: "UPDATE",
          before,
          after: updated,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return updated;
    });
    this.invalidateCache();
    return after;
  }
}

function toEffectiveRule(row: AlertRule): EffectiveAlertRule {
  return {
    flappingThreshold: row.flappingThreshold,
    flappingWindowMinutes: row.flappingWindowMinutes,
    suppressAutoTicketDuringMaintenance: row.suppressAutoTicketDuringMaintenance,
    pagingSeverities: row.pagingSeverities as AlertSeverity[],
    autoCorrelateIncidents: row.autoCorrelateIncidents,
  };
}
