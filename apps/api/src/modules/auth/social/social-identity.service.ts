import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { User } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { SocialIdentity } from "./social-provider";

/** Why a social sign-in was refused — surfaced to the login page as `?social_error=<code>`. */
export type SocialRejectReason =
  "not_provisioned" | "inactive" | "email_missing" | "email_unverified" | "identity_mismatch";

export class SocialLoginRejectedError extends Error {
  constructor(
    readonly reason: SocialRejectReason,
    readonly detail: string,
  ) {
    super(`social sign-in rejected (${reason}): ${detail}`);
  }
}

/** How long the callback -> web-app handoff code stays redeemable. */
const HANDOFF_TTL_MS = 60_000;

/**
 * Maps a verified social identity onto an existing OpsDesk user (no
 * self-registration: an admin adds people first).
 *
 * Trust order:
 *  1. A linked identity with the same (issuer, subject) -> that user, even if
 *     the provider-side email has since changed.
 *  2. Otherwise a **verified** email matching an existing user -> link this
 *     identity to them (audited), unless they already have a *different*
 *     account from the same provider linked.
 */
@Injectable()
export class SocialIdentityService {
  private readonly logger = new Logger(SocialIdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async resolveUser(identity: SocialIdentity, correlationId?: string): Promise<User> {
    try {
      const user = await this.matchOrLink(identity, correlationId);
      if (!user.isActive) {
        throw new SocialLoginRejectedError("inactive", `user ${user.id} is inactive`);
      }
      await this.prisma.userIdentity.update({
        where: { issuer_subject: { issuer: identity.issuer, subject: identity.subject } },
        data: { lastLoginAt: new Date(), email: identity.email },
      });
      await this.audit.record({
        actorId: user.id,
        entityType: "USER",
        entityId: user.id,
        action: "USER_SOCIAL_LOGIN",
        after: { provider: identity.provider },
        correlationId,
      });
      return user;
    } catch (err) {
      if (err instanceof SocialLoginRejectedError) {
        this.logger.warn(err.message);
        await this.audit.record({
          actorId: null,
          entityType: "USER",
          entityId: identity.email ?? `${identity.provider}:${identity.subject}`,
          action: "USER_SOCIAL_LOGIN_REJECTED",
          after: { reason: err.reason, provider: identity.provider, subject: identity.subject },
          correlationId,
        });
      }
      throw err;
    }
  }

  private async matchOrLink(identity: SocialIdentity, correlationId?: string): Promise<User> {
    const linked = await this.prisma.userIdentity.findUnique({
      where: { issuer_subject: { issuer: identity.issuer, subject: identity.subject } },
      include: { user: true },
    });
    if (linked) return linked.user;

    if (!identity.email) {
      throw new SocialLoginRejectedError(
        "email_missing",
        `${identity.provider} sent no email for ${identity.subject}`,
      );
    }
    // Linking by email requires the provider to vouch for it. Google and
    // GitHub say so explicitly; an absent claim (Microsoft work accounts) is
    // accepted because config only allows a single, trusted tenant.
    if (identity.emailVerified === false) {
      throw new SocialLoginRejectedError("email_unverified", `${identity.email} is not verified`);
    }

    const user = await this.prisma.user.findFirst({
      where: { email: { equals: identity.email, mode: "insensitive" } },
      include: { identities: { where: { provider: identity.provider } } },
    });
    if (!user) {
      throw new SocialLoginRejectedError("not_provisioned", `no user for ${identity.email}`);
    }
    if (user.identities.length > 0) {
      throw new SocialLoginRejectedError(
        "identity_mismatch",
        `${identity.email} already has a different ${identity.provider} account linked`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.userIdentity.create({
        data: {
          userId: user.id,
          provider: identity.provider,
          issuer: identity.issuer,
          subject: identity.subject,
          email: identity.email,
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          entityType: "USER",
          entityId: user.id,
          action: "USER_IDENTITY_LINKED",
          after: {
            provider: identity.provider,
            issuer: identity.issuer,
            subject: identity.subject,
          },
          correlationId,
        },
        tx,
      );
      return tx.user.findUniqueOrThrow({ where: { id: user.id } });
    });
  }

  /** Issues a single-use code the web app trades for the app JWT. Only its hash is stored. */
  async createHandoffCode(userId: string): Promise<string> {
    const code = randomBytes(32).toString("base64url");
    const now = Date.now();
    await this.prisma.$transaction([
      // opportunistic cleanup — codes are useless a minute after issue
      this.prisma.loginHandoffCode.deleteMany({
        where: { expiresAt: { lt: new Date(now - 60 * 60_000) } },
      }),
      this.prisma.loginHandoffCode.create({
        data: { codeHash: sha256(code), userId, expiresAt: new Date(now + HANDOFF_TTL_MS) },
      }),
    ]);
    return code;
  }

  /** Atomically consumes a handoff code; any replay, expiry or unknown code is a 401. */
  async redeemHandoffCode(code: string): Promise<User> {
    const codeHash = sha256(code);
    const now = new Date();
    const { count } = await this.prisma.loginHandoffCode.updateMany({
      where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (count !== 1) {
      throw new UnauthorizedException("Sign-in code is invalid or expired");
    }
    const row = await this.prisma.loginHandoffCode.findUnique({
      where: { codeHash },
      include: { user: true },
    });
    if (!row || !row.user.isActive) {
      throw new UnauthorizedException("Sign-in code is invalid or expired");
    }
    return row.user;
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
