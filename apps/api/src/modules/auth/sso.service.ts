import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { User } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OidcIdentity } from "./oidc/oidc-client.service";

/** Why an SSO login was refused — surfaced to the login page as `?sso_error=<code>`. */
export type SsoRejectReason =
  "not_provisioned" | "inactive" | "email_missing" | "email_unverified" | "identity_mismatch";

export class SsoLoginRejectedError extends Error {
  constructor(
    readonly reason: SsoRejectReason,
    readonly detail: string,
  ) {
    super(`SSO login rejected (${reason}): ${detail}`);
  }
}

/** How long the callback -> web-app handoff code stays redeemable. */
const LOGIN_CODE_TTL_MS = 60_000;

/**
 * Maps a verified IdP identity onto a pre-provisioned OpsDesk user
 * (no self-registration: an admin creates the user and their role first).
 *
 * Trust order:
 *  1. (idpIssuer, idpSubject) match -> that user. Stable even if the IdP
 *     email changes later.
 *  2. Otherwise an email match on a user not yet linked to any IdP
 *     (idpIssuer NULL) -> link it to this (issuer, subject), audited.
 *  3. An email match on a user already linked to a *different* identity is
 *     refused — the email alone never overrides an existing link.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async resolveUser(identity: OidcIdentity, correlationId?: string): Promise<User> {
    try {
      const user = await this.matchOrLink(identity, correlationId);
      if (!user.isActive) {
        throw new SsoLoginRejectedError("inactive", `user ${user.id} is inactive`);
      }
      await this.audit.record({
        actorId: user.id,
        entityType: "USER",
        entityId: user.id,
        action: "USER_SSO_LOGIN",
        after: { issuer: identity.issuer },
        correlationId,
      });
      return user;
    } catch (err) {
      if (err instanceof SsoLoginRejectedError) {
        this.logger.warn(err.message);
        await this.audit.record({
          actorId: null,
          entityType: "USER",
          entityId: identity.email ?? identity.subject,
          action: "USER_SSO_LOGIN_REJECTED",
          after: { reason: err.reason, issuer: identity.issuer, subject: identity.subject },
          correlationId,
        });
      }
      throw err;
    }
  }

  private async matchOrLink(identity: OidcIdentity, correlationId?: string): Promise<User> {
    const linked = await this.prisma.user.findFirst({
      where: { idpIssuer: identity.issuer, idpSubject: identity.subject },
    });
    if (linked) return linked;

    if (!identity.email) {
      throw new SsoLoginRejectedError("email_missing", `IdP sent no email for ${identity.subject}`);
    }
    // Absent email_verified is accepted (several enterprise IdPs, e.g. Entra,
    // don't send it for directory-managed mail); an explicit false is not.
    if (identity.emailVerified === false) {
      throw new SsoLoginRejectedError("email_unverified", `${identity.email} is not verified`);
    }

    const byEmail = await this.prisma.user.findFirst({
      where: { email: { equals: identity.email, mode: "insensitive" } },
    });
    if (!byEmail) {
      throw new SsoLoginRejectedError("not_provisioned", `no user for ${identity.email}`);
    }
    if (byEmail.idpIssuer !== null) {
      throw new SsoLoginRejectedError(
        "identity_mismatch",
        `${identity.email} is already linked to a different IdP identity`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: byEmail.id },
        data: { idpIssuer: identity.issuer, idpSubject: identity.subject },
      });
      await this.audit.record(
        {
          actorId: byEmail.id,
          entityType: "USER",
          entityId: byEmail.id,
          action: "USER_IDP_LINKED",
          before: { idpIssuer: null, idpSubject: byEmail.idpSubject },
          after: { idpIssuer: identity.issuer, idpSubject: identity.subject },
          correlationId,
        },
        tx,
      );
      return updated;
    });
  }

  /** Issues a single-use code the web app trades for the app JWT. Only its hash is stored. */
  async createLoginCode(userId: string): Promise<string> {
    const code = randomBytes(32).toString("base64url");
    const now = Date.now();
    await this.prisma.$transaction([
      // opportunistic cleanup — codes are useless a minute after issue
      this.prisma.ssoLoginCode.deleteMany({
        where: { expiresAt: { lt: new Date(now - 60 * 60_000) } },
      }),
      this.prisma.ssoLoginCode.create({
        data: { codeHash: hashCode(code), userId, expiresAt: new Date(now + LOGIN_CODE_TTL_MS) },
      }),
    ]);
    return code;
  }

  /** Atomically consumes a login code; any replay, expiry or unknown code is a 401. */
  async redeemLoginCode(code: string): Promise<User> {
    const codeHash = hashCode(code);
    const now = new Date();
    const { count } = await this.prisma.ssoLoginCode.updateMany({
      where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (count !== 1) {
      throw new UnauthorizedException("Login code is invalid or expired");
    }
    const row = await this.prisma.ssoLoginCode.findUnique({
      where: { codeHash },
      include: { user: true },
    });
    if (!row || !row.user.isActive) {
      throw new UnauthorizedException("Login code is invalid or expired");
    }
    return row.user;
  }
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
