import { Injectable, Logger } from "@nestjs/common";
import {
  AlertSeverity,
  InAppNotificationKind,
  NotificationSoundRule,
  NotificationUrgency,
  Priority,
} from "@prisma/client";
import { ActorContext } from "../../common/types/actor-context.type";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

/** 1 is the most severe: P1 or a CRITICAL alert. 4 is P4 or INFO. */
export type NotificationLevel = 1 | 2 | 3 | 4;
export const NOTIFICATION_LEVELS: readonly NotificationLevel[] = [1, 2, 3, 4];

/** How long {@link NotificationSoundRulesService.resolve} may serve cached rows. */
export const SOUND_RULE_CACHE_TTL_MS = 30_000;

const PRIORITY_LEVEL: Record<Priority, NotificationLevel> = { P1: 1, P2: 2, P3: 3, P4: 4 };
const SEVERITY_LEVEL: Record<AlertSeverity, NotificationLevel> = {
  CRITICAL: 1,
  HIGH: 2,
  WARNING: 3,
  INFO: 4,
};

export function levelForPriority(priority: Priority): NotificationLevel {
  return PRIORITY_LEVEL[priority];
}

export function levelForAlertSeverity(severity: AlertSeverity): NotificationLevel {
  return SEVERITY_LEVEL[severity];
}

const { CRITICAL, HIGH, NORMAL, SILENT } = NotificationUrgency;

/**
 * Served for any (kind, level) with no saved row. Indexed by level - 1.
 * Admins override individual cells from the Notification sounds page.
 */
export const DEFAULT_SOUND_RULES: Record<
  InAppNotificationKind,
  readonly [NotificationUrgency, NotificationUrgency, NotificationUrgency, NotificationUrgency]
> = {
  INCIDENT_CREATED: [CRITICAL, HIGH, NORMAL, NORMAL],
  INCIDENT_ASSIGNED: [CRITICAL, HIGH, NORMAL, NORMAL],
  INCIDENT_GROUP_ASSIGNED: [CRITICAL, HIGH, NORMAL, NORMAL],
  INCIDENT_STATUS_CHANGED: [NORMAL, NORMAL, NORMAL, NORMAL],
  INCIDENT_COMMENT_ADDED: [SILENT, SILENT, SILENT, SILENT],
  SLA_WARNING: [HIGH, HIGH, HIGH, HIGH],
  SLA_BREACHED: [CRITICAL, CRITICAL, CRITICAL, CRITICAL],
  INCIDENT_OFFERED: [HIGH, HIGH, HIGH, HIGH],
  INCIDENT_OFFER_UNACCEPTED: [CRITICAL, CRITICAL, CRITICAL, CRITICAL],
  ALERT_RAISED: [CRITICAL, HIGH, NORMAL, NORMAL],
  ALERT_RECOVERED: [SILENT, SILENT, SILENT, SILENT],
};

export interface SoundRuleCell {
  kind: InAppNotificationKind;
  level: NotificationLevel;
  urgency: NotificationUrgency;
  /** True when no row is saved and the code default applies. */
  isDefault: boolean;
  updatedAt: Date | null;
}

/**
 * Owns the `notification_sound_rules` config table: which sound tier each
 * notification kind gets at each level. InboxService resolves the tier when
 * it writes a notification row, so the browser only reads `urgency`.
 * resolve() runs on every notification write, so rows are cached for
 * {@link SOUND_RULE_CACHE_TTL_MS} and every save busts the cache.
 */
@Injectable()
export class NotificationSoundRulesService {
  private readonly logger = new Logger(NotificationSoundRulesService.name);
  private cache: { rules: NotificationSoundRule[]; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** The tier for one notification. Never throws: a lookup failure falls
   *  back to the code default so a notification is never lost over it. */
  async resolve(
    kind: InAppNotificationKind,
    level: NotificationLevel,
  ): Promise<NotificationUrgency> {
    try {
      const row = (await this.rules()).find((r) => r.kind === kind && r.level === level);
      if (row) {
        return row.urgency;
      }
    } catch (err) {
      this.logger.warn(
        `sound rule lookup failed for ${kind}/${level}, using default: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return DEFAULT_SOUND_RULES[kind][level - 1];
  }

  /** Every kind x level cell, saved rows over code defaults. */
  async list(): Promise<SoundRuleCell[]> {
    const rows = await this.prisma.notificationSoundRule.findMany();
    const cells: SoundRuleCell[] = [];
    for (const kind of Object.values(InAppNotificationKind)) {
      for (const level of NOTIFICATION_LEVELS) {
        const row = rows.find((r) => r.kind === kind && r.level === level);
        cells.push({
          kind,
          level,
          urgency: row?.urgency ?? DEFAULT_SOUND_RULES[kind][level - 1],
          isDefault: !row,
          updatedAt: row?.updatedAt ?? null,
        });
      }
    }
    return cells;
  }

  /** Saves one cell, audited in the same transaction. */
  async set(
    kind: InAppNotificationKind,
    level: NotificationLevel,
    urgency: NotificationUrgency,
    actor: ActorContext,
  ): Promise<SoundRuleCell> {
    const saved = await this.prisma.$transaction(async (tx) => {
      const before = await tx.notificationSoundRule.findUnique({
        where: { kind_level: { kind, level } },
      });
      const after = await tx.notificationSoundRule.upsert({
        where: { kind_level: { kind, level } },
        create: { kind, level, urgency },
        update: { urgency },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "NOTIFICATION_SOUND_RULE",
          entityId: after.id,
          action: before ? "NOTIFICATION_SOUND_RULE_UPDATED" : "NOTIFICATION_SOUND_RULE_CREATED",
          before: before ?? { kind, level, urgency: DEFAULT_SOUND_RULES[kind][level - 1] },
          after,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return after;
    });
    this.cache = null;
    return {
      kind: saved.kind,
      level,
      urgency: saved.urgency,
      isDefault: false,
      updatedAt: saved.updatedAt,
    };
  }

  private async rules(): Promise<NotificationSoundRule[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.rules;
    }
    const rules = await this.prisma.notificationSoundRule.findMany();
    this.cache = { rules, expiresAt: Date.now() + SOUND_RULE_CACHE_TTL_MS };
    return rules;
  }
}
