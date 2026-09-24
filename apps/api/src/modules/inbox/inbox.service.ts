import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InAppNotificationKind } from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";

export const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

export interface InAppNotificationInput {
  /** Candidate recipients; inactive or unknown users are skipped. */
  userIds: (string | null | undefined)[];
  kind: InAppNotificationKind;
  title: string;
  body?: string;
  entityType: "INCIDENT";
  entityId: string;
  /** Stable per-event key. Writing the same key twice for a user is a no-op.
   *  Omit for events that have no natural key; a random one is used. */
  dedupeKey?: string;
  /** Whoever caused the event. They don't need to be told about it. */
  actorUserId?: string | null;
}

/**
 * The in-app side of notifications: a per-user bell list the web app polls.
 * Callers invoke notifyUsers() after their own mutation has committed, the
 * same way they enqueue the matching email. Like the email path it's
 * best-effort: a failure is logged and never thrown back to the caller.
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async notifyUsers(input: InAppNotificationInput): Promise<void> {
    try {
      const ids = [
        ...new Set(
          input.userIds.filter((id): id is string => Boolean(id) && id !== input.actorUserId),
        ),
      ];
      if (ids.length === 0) {
        return;
      }
      const recipients = await this.prisma.user.findMany({
        where: { id: { in: ids }, isActive: true },
        select: { id: true },
      });
      if (recipients.length === 0) {
        return;
      }
      const dedupeKey = input.dedupeKey ?? randomUUID();
      await this.prisma.inAppNotification.createMany({
        data: recipients.map((r) => ({
          userId: r.id,
          kind: input.kind,
          title: input.title,
          body: input.body,
          entityType: input.entityType,
          entityId: input.entityId,
          dedupeKey,
        })),
        skipDuplicates: true,
      });
    } catch (err) {
      this.logger.warn(
        `in-app ${input.kind} notification skipped for ${input.entityType} ${input.entityId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** The caller's own notifications, newest first, plus their unread count. */
  async listForUser(user: AuthenticatedUser, limit?: number) {
    const take = Math.min(Math.max(limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    const [items, unreadCount] = await Promise.all([
      this.prisma.inAppNotification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take,
      }),
      this.prisma.inAppNotification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { items, unreadCount };
  }

  /** Marks one of the caller's notifications read. Someone else's id is a
   *  404, the same as an id that doesn't exist. Idempotent. */
  async markRead(id: string, user: AuthenticatedUser) {
    const existing = await this.prisma.inAppNotification.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      throw new NotFoundException("Notification not found");
    }
    if (existing.readAt) {
      return existing;
    }
    return this.prisma.inAppNotification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(user: AuthenticatedUser) {
    const { count } = await this.prisma.inAppNotification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  retentionDays(): number {
    const raw = this.config.get<string>("NOTIFICATION_RETENTION_DAYS");
    const days = raw === undefined || raw === "" ? DEFAULT_RETENTION_DAYS : Number(raw);
    if (!Number.isInteger(days) || days < 1) {
      this.logger.warn(
        `NOTIFICATION_RETENTION_DAYS=${raw} is not a positive whole number; using ${DEFAULT_RETENTION_DAYS}`,
      );
      return DEFAULT_RETENTION_DAYS;
    }
    return days;
  }

  /** Daily cleanup of notifications older than the retention window. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.retentionDays() * 24 * 60 * 60 * 1000);
    try {
      const { count } = await this.prisma.inAppNotification.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (count > 0) {
        this.logger.log(
          `purged ${count} in-app notification(s) older than ${cutoff.toISOString()}`,
        );
      }
      return count;
    } catch (err) {
      this.logger.error(
        `in-app notification purge failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }
}
