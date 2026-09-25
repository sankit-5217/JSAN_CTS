import { Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import { sha256 } from "./social/social-identity.service";
import { AuthenticatedUser } from "./types/jwt-payload.type";

/** Every API token starts with this, so the auth guard can tell it from a JWT. */
export const API_TOKEN_PREFIX = "odk_";
const DISPLAY_PREFIX_LEN = 12;
/** Don't write last_used_at on every request — once per window is enough. */
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60_000;

export interface ApiTokenView {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

const VIEW_SELECT = {
  id: true,
  name: true,
  prefix: true,
  createdAt: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;

/**
 * Long-lived, revocable tokens for machine accounts (site collector, worker)
 * — they can't do an interactive sign-in. Created by a Super Admin, shown
 * exactly once, stored only as SHA-256 (the token is 256 random bits, so a
 * fast hash is fine — unlike passwords). The token acts as its user: same
 * role, same site scope, blocked the moment the user is deactivated.
 */
@Injectable()
export class ApiTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<ApiTokenView[]> {
    await this.assertUser(userId);
    return this.prisma.apiToken.findMany({
      where: { userId },
      select: VIEW_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  async create(
    userId: string,
    input: { name: string; expiresInDays?: number },
    actor: ActorContext,
  ): Promise<ApiTokenView & { token: string }> {
    await this.assertUser(userId);
    const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 3600_000)
      : null;
    const view = await this.prisma.$transaction(async (tx) => {
      const row = await tx.apiToken.create({
        data: {
          userId,
          name: input.name,
          tokenHash: sha256(token),
          prefix: token.slice(0, DISPLAY_PREFIX_LEN),
          expiresAt,
          createdById: actor.actorId,
        },
        select: VIEW_SELECT,
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          entityType: "USER",
          entityId: userId,
          action: "API_TOKEN_CREATED",
          after: { tokenId: row.id, name: row.name, prefix: row.prefix, expiresAt },
          correlationId: actor.correlationId,
        },
        tx,
      );
      return row;
    });
    return { ...view, token };
  }

  async revoke(userId: string, tokenId: string, actor: ActorContext): Promise<ApiTokenView> {
    const row = await this.prisma.apiToken.findFirst({ where: { id: tokenId, userId } });
    if (!row) throw new NotFoundException(`API token ${tokenId} not found`);
    if (row.revokedAt) return pick(row);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.apiToken.update({
        where: { id: tokenId },
        data: { revokedAt: new Date() },
        select: VIEW_SELECT,
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          entityType: "USER",
          entityId: userId,
          action: "API_TOKEN_REVOKED",
          after: { tokenId, name: row.name, prefix: row.prefix },
          correlationId: actor.correlationId,
        },
        tx,
      );
      return updated;
    });
  }

  /** The user a presented token acts as, or null (unknown, revoked, expired, inactive user). */
  async authenticate(token: string): Promise<AuthenticatedUser | null> {
    if (!token.startsWith(API_TOKEN_PREFIX)) return null;
    const row = await this.prisma.apiToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    const now = new Date();
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= now) || !row.user.isActive) {
      return null;
    }
    if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
      await this.prisma.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
    }
    const { user } = row;
    return { id: user.id, email: user.email, role: user.role, isActive: user.isActive };
  }

  private async assertUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
  }
}

function pick(row: ApiTokenView): ApiTokenView {
  const { id, name, prefix, createdAt, expiresAt, lastUsedAt, revokedAt } = row;
  return { id, name, prefix, createdAt, expiresAt, lastUsedAt, revokedAt };
}
