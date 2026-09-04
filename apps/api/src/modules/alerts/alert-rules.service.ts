import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AlertRule } from "@prisma/client";
import { ActorContext } from "../../common/types/actor-context.type";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DEFAULT_ALERT_RULE } from "./alerts.constants";
import type { AlertSeverity, EffectiveAlertRule } from "./alerts.constants";
import { CreateAlertRuleDto } from "./dto/create-alert-rule.dto";
import { UpdateAlertRuleDto } from "./dto/update-alert-rule.dto";

/** How long {@link AlertRulesService.getActiveRule} may serve a cached value. */
export const ALERT_RULE_CACHE_TTL_MS = 30_000;

/**
 * Owns the `alert_rules` config table (spec §10.10 "config over hard-code"):
 * the tunables the ingestion path used to read from env / code constants —
 * flapping threshold + window, which severities page the NOC, whether a live
 * alert is auto-correlated to an open incident.
 *
 * `getActiveRule()` is on the high-volume ingest path, so it caches the newest
 * active row for {@link ALERT_RULE_CACHE_TTL_MS}; every mutation busts the
 * cache. With no active row the code default is served, so ingestion behaves
 * identically before the table is seeded.
 */
@Injectable()
export class AlertRulesService {
  private readonly logger = new Logger(AlertRulesService.name);
  private cache: { value: EffectiveAlertRule; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Effective policy for the ingest path — cached, falls back to code defaults. */
  async getActiveRule(): Promise<EffectiveAlertRule> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.value;
    }
    const row = await this.prisma.alertRule.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });
    const value = row ? toEffectiveRule(row) : DEFAULT_ALERT_RULE;
    this.cache = { value, expiresAt: Date.now() + ALERT_RULE_CACHE_TTL_MS };
    return value;
  }

  /** Drop the cached rule so the next ingest re-reads the table. */
  invalidateCache(): void {
    this.cache = null;
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
