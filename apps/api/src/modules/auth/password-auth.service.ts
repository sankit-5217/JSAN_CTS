import { BadRequestException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { User } from "@prisma/client";
import { randomBytes } from "crypto";
import { AccountMailPublisher } from "../../common/notifications/account-mail.publisher";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { readAuthConfig } from "./auth.config";
import {
  dummyPasswordHash,
  hashPassword,
  passwordPolicyProblem,
  verifyPassword,
} from "./password-hasher";
import { sha256 } from "./social/social-identity.service";

export type PasswordTokenPurpose = "INVITE" | "RESET";

/** After this many wrong passwords in a row the account locks for LOCKOUT_MS. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60_000;
const TOKEN_TTL_MS: Record<PasswordTokenPurpose, number> = {
  INVITE: 72 * 3600_000,
  RESET: 3600_000,
};

const INVALID_CREDENTIALS = "Invalid email or password";

export interface SignInLinkResult {
  /** The link itself — shown to the admin as a fallback when email isn't available. */
  link: string;
  expiresAt: Date;
  purpose: PasswordTokenPurpose;
  /** False when the email couldn't be queued (no Redis): share the link another way. */
  emailQueued: boolean;
}

/**
 * Email + password sign-in (spec §17: no *weak* password store — scrypt
 * hashes, a length-first policy, per-account lockout, per-IP rate limits,
 * audited). Admins never see or set passwords: people choose their own via
 * a single-use emailed link (invite or reset).
 */
@Injectable()
export class PasswordAuthService {
  private readonly logger = new Logger(PasswordAuthService.name);
  private readonly webAppUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: AccountMailPublisher,
    config: ConfigService,
  ) {
    this.webAppUrl = readAuthConfig(config).webAppUrl;
  }

  async login(email: string, password: string, correlationId?: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    // Unknown email / no password yet: same work and same answer as a wrong
    // password, so the response doesn't reveal which accounts exist.
    if (!user || !user.passwordHash) {
      await verifyPassword(password, await dummyPasswordHash());
      this.logger.warn(
        `password sign-in failed for ${email}: ${user ? "no password set" : "unknown email"}`,
      );
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.audit.record({
        actorId: null,
        entityType: "USER",
        entityId: user.id,
        action: "USER_LOGIN_FAILED",
        after: { reason: "locked" },
        correlationId,
      });
      throw new UnauthorizedException(
        "Too many failed attempts. Try again in 15 minutes, or reset your password.",
      );
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: lock
          ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MS) }
          : { failedLoginCount: failed },
      });
      await this.audit.record({
        actorId: null,
        entityType: "USER",
        entityId: user.id,
        action: lock ? "USER_LOCKED_OUT" : "USER_LOGIN_FAILED",
        after: { reason: "wrong_password", failedAttempts: failed },
        correlationId,
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    // The password was right, so it's safe to say why they still can't in.
    if (!user.isActive) {
      throw new UnauthorizedException(
        "This account is deactivated. Contact an OpsDesk administrator.",
      );
    }

    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }
    await this.audit.record({
      actorId: user.id,
      entityType: "USER",
      entityId: user.id,
      action: "USER_PASSWORD_LOGIN",
      correlationId,
    });
    return user;
  }

  /**
   * Creates a single-use set-password link (invalidating any earlier unused
   * one for the user) and emails it. INVITE for someone who has never set a
   * password, RESET otherwise. `actorId` null = self-service "forgot password".
   */
  async sendSignInLink(
    userId: string,
    actor: { actorId: string | null; correlationId?: string },
  ): Promise<SignInLinkResult> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const purpose: PasswordTokenPurpose = user.passwordHash ? "RESET" : "INVITE";
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS[purpose]);

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.passwordToken.create({
        data: {
          userId,
          tokenHash: sha256(token),
          purpose,
          expiresAt,
          createdById: actor.actorId,
        },
      });
      await this.audit.record(
        {
          actorId: actor.actorId,
          entityType: "USER",
          entityId: userId,
          action: purpose === "INVITE" ? "USER_INVITE_SENT" : "USER_PASSWORD_RESET_SENT",
          after: { expiresAt, selfService: actor.actorId === null },
          correlationId: actor.correlationId,
        },
        tx,
      );
    });

    // Fragment, not query: never sent to a server or leaked via Referer.
    const link = `${this.webAppUrl}/auth/set-password#token=${token}`;
    const inviter = actor.actorId
      ? await this.prisma.user.findUnique({
          where: { id: actor.actorId },
          select: { displayName: true, email: true },
        })
      : null;
    const expiresText = expiresAt.toISOString().slice(0, 16).replace("T", " ");
    const emailQueued = await this.mail.send(
      purpose === "INVITE"
        ? {
            kind: "ACCOUNT_INVITE",
            to: { name: user.displayName, email: user.email },
            link,
            expiresAt: expiresText,
            invitedBy: inviter ? { name: inviter.displayName, email: inviter.email } : undefined,
          }
        : {
            kind: "PASSWORD_RESET",
            to: { name: user.displayName, email: user.email },
            link,
            expiresAt: expiresText,
          },
    );
    return { link, expiresAt, purpose, emailQueued };
  }

  /** Self-service reset. Always "succeeds" so it can't be used to probe for accounts. */
  async requestReset(email: string, correlationId?: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, isActive: true },
      select: { id: true },
    });
    if (!user) {
      this.logger.warn(`password reset requested for unknown/inactive ${email}`);
      return;
    }
    await this.sendSignInLink(user.id, { actorId: null, correlationId });
  }

  /** Who a link is for, so the set-password page can greet them. */
  async inspectToken(
    token: string,
  ): Promise<{ email: string; displayName: string; purpose: string }> {
    const row = await this.findUsableToken(token);
    return { email: row.user.email, displayName: row.user.displayName, purpose: row.purpose };
  }

  /** Sets the password from a link, consuming it and signing out every other session. */
  async setPassword(token: string, password: string, correlationId?: string): Promise<User> {
    const row = await this.findUsableToken(token);
    const problem = passwordPolicyProblem(password, row.user.email);
    if (problem) throw new BadRequestException(problem);
    if (!row.user.isActive) {
      throw new BadRequestException(
        "This account is deactivated. Contact an OpsDesk administrator.",
      );
    }
    const passwordHash = await hashPassword(password);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.passwordToken.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (count !== 1) throw new BadRequestException("This link has expired or was already used.");
      const user = await tx.user.update({
        where: { id: row.userId },
        data: {
          passwordHash,
          passwordSetAt: now,
          failedLoginCount: 0,
          lockedUntil: null,
          sessionVersion: { increment: 1 },
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          entityType: "USER",
          entityId: user.id,
          action: "USER_PASSWORD_SET",
          after: { via: row.purpose },
          correlationId,
        },
        tx,
      );
      return user;
    });
  }

  private async findUsableToken(token: string) {
    const row = await this.prisma.passwordToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!row || row.usedAt || row.expiresAt <= new Date()) {
      throw new BadRequestException("This link has expired or was already used.");
    }
    return row;
  }
}
