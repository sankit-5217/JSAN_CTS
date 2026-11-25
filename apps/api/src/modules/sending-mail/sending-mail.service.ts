import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { isEmail } from "class-validator";
import { createHash, randomBytes } from "crypto";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { RenderedEmail } from "@cts-dc-opsdesk/email-adapter";
import { PrismaService } from "../../common/prisma/prisma.service";
import { decryptSecret, encryptSecret, loadSecretsKey } from "../../common/crypto/secret-cipher";
import { AuditService } from "../audit/audit.service";
import { oauthProvider, SMTP_PROVIDERS } from "./providers";

interface Credentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  password?: string;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Where a finished mailbox connection returns the user. A fixed allowlist,
 * never a caller-supplied URL — the OAuth callback redirects here, so an
 * arbitrary path would turn it into an open redirect.
 */
const RETURN_PATHS = ["/", "/client/home", "/account/email"] as const;

/** The home a role belongs to: the client portal for clients, the console for staff. */
export function defaultReturnPath(role: string): string {
  return role === "CLIENT_MANAGER_VIEWER" ? "/client/home" : "/";
}

/** The path carried inside an OAuth state, or null when it isn't one of ours. */
export function returnPathFromState(state: string | undefined): string | null {
  if (!state) return null;
  const encoded = state.split(".")[1];
  if (!encoded) return null;
  try {
    const path = Buffer.from(encoded, "base64url").toString("utf8");
    return (RETURN_PATHS as readonly string[]).includes(path) ? path : null;
  } catch {
    return null;
  }
}

function resolveReturnPath(role: string, next?: string): string {
  if (next && (RETURN_PATHS as readonly string[]).includes(next)) return next;
  return defaultReturnPath(role);
}

@Injectable()
export class SendingMailService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async activeUser(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.isActive) throw new ForbiddenException("Only active users can manage sending email");
    if (!isEmail(user.email))
      throw new ForbiddenException("Your OpsDesk account must have a valid registered email");
    return user;
  }

  async status(userId: string) {
    const user = await this.activeUser(userId);
    const savedAccount = await this.db.sendingAccount.findUnique({
      where: { userId },
      select: { email: true, provider: true, updatedAt: true },
    });
    const account =
      savedAccount?.email.toLowerCase() === user.email.toLowerCase() ? savedAccount : null;
    return {
      account,
      senderEmail: user.email,
      providers: ["google", "microsoft"].map((provider) => {
        try {
          oauthProvider(provider);
          return { provider, configured: true };
        } catch {
          return { provider, configured: false };
        }
      }),
      // App-password mailboxes: no admin setup, so every user can reach them
      // from the same step as the OAuth providers.
      smtpProviders: Object.keys(SMTP_PROVIDERS).map((provider) => ({ provider })),
    };
  }

  /**
   * Starts a provider authorization. `next` is the page the user should come
   * back to once the provider answers — the sign-in step sends them to their
   * own home, so nobody has to hunt for the mailbox screen afterwards.
   */
  async connect(userId: string, provider: string, next?: string) {
    const config = oauthProvider(provider);
    const user = await this.activeUser(userId);
    const returnPath = resolveReturnPath(user.role, next);
    const state = `${randomBytes(32).toString("base64url")}.${Buffer.from(returnPath).toString(
      "base64url",
    )}`;
    const verifier = randomBytes(32).toString("base64url");
    await this.db.mailAuthorization.deleteMany({
      where: { OR: [{ userId }, { expiresAt: { lt: new Date() } }] },
    });
    await this.db.mailAuthorization.create({
      data: {
        userId,
        stateHash: hash(state),
        provider,
        sessionVersion: user.sessionVersion,
        verifier: encryptSecret(verifier, loadSecretsKey()),
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const url = new URL(config.authorize);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: config.scope,
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "consent",
      login_hint: user.email,
      ...(provider === "google" ? { access_type: "offline" } : {}),
    }).toString();
    return { url: url.toString() };
  }

  private async token(provider: string, values: Record<string, string>) {
    const config = oauthProvider(provider);
    const response = await fetch(config.token, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...values,
      }),
    });
    if (!response.ok)
      throw new ServiceUnavailableException(
        "Mailbox authorization failed. Reconnect your email account.",
      );
    const result = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };
    if (!result.access_token)
      throw new ServiceUnavailableException("Provider returned no access token");
    return result;
  }

  /** Completes an authorization and reports where the user belongs next. */
  async callback(provider: string, state: string, code?: string): Promise<string> {
    // Atomically claim state once. Keep it until save so disconnect also cancels in-flight callbacks.
    const stateHash = hash(state);
    const pending = await this.db.$transaction(async (tx) => {
      const row = await tx.mailAuthorization.findUnique({ where: { stateHash } });
      if (!row) throw new BadRequestException("Invalid authorization state");
      const claimed = await tx.mailAuthorization.updateMany({
        where: { stateHash, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (!claimed.count) throw new BadRequestException("Authorization state already used");
      return row;
    });
    if (pending.provider !== provider || pending.expiresAt.getTime() < Date.now() || !code)
      throw new BadRequestException("Expired or refused authorization");
    const user = await this.activeUser(pending.userId);
    if (!user.isActive || user.sessionVersion !== pending.sessionVersion)
      throw new BadRequestException("Sign in again to connect email");
    const config = oauthProvider(provider);
    const tokens = await this.token(provider, {
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: decryptSecret(pending.verifier, loadSecretsKey()),
    });
    if (!tokens.refresh_token)
      throw new BadRequestException(
        "Offline sending permission is required. Reconnect and grant access.",
      );
    const response = await fetch(
      provider === "google"
        ? "https://openidconnect.googleapis.com/v1/userinfo"
        : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName",
      {
        headers: { authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) throw new BadRequestException("Could not verify the connected mailbox");
    const profile = (await response.json()) as {
      email?: string;
      email_verified?: boolean;
      mail?: string;
      userPrincipalName?: string;
    };
    const email = provider === "google" ? profile.email : profile.mail || profile.userPrincipalName;
    if (
      !email ||
      email.toLowerCase() !== user.email.toLowerCase() ||
      (provider === "google" && !profile.email_verified)
    ) {
      throw new BadRequestException("Connect the email address registered to your OpsDesk account");
    }
    const requiredScope =
      provider === "google" ? "https://www.googleapis.com/auth/gmail.send" : "Mail.Send";
    if (!tokens.scope?.split(" ").includes(requiredScope))
      throw new BadRequestException("Permission to send email is required");
    await this.save(
      user.id,
      provider,
      email,
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      },
      { stateHash, sessionVersion: pending.sessionVersion },
    );
    return returnPathFromState(state) ?? defaultReturnPath(user.role);
  }

  async connectSmtp(userId: string, provider: string, password: string) {
    const config = SMTP_PROVIDERS[provider];
    if (!config) throw new BadRequestException("Unsupported SMTP provider");
    const user = await this.activeUser(userId);
    const email = user.email;
    const transport = nodemailer.createTransport({
      ...config,
      secure: config.port === 465,
      requireTLS: true,
      auth: { user: email, pass: password },
      connectionTimeout: 15_000,
      socketTimeout: 20_000,
    });
    try {
      await transport.verify();
    } catch {
      throw new BadRequestException("Mailbox login failed. Check your provider and app password.");
    } finally {
      transport.close();
    }
    await this.save(userId, provider, email, { password });
  }

  private async save(
    userId: string,
    provider: string,
    email: string,
    credentials: Credentials,
    authorization?: { stateHash: string; sessionVersion: number },
  ) {
    const encrypted = encryptSecret(JSON.stringify(credentials), loadSecretsKey());
    await this.db.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.isActive || user.email.toLowerCase() !== email.toLowerCase())
        throw new BadRequestException("Registered email has changed; reconnect your sending email");
      if (authorization) {
        if (user.sessionVersion !== authorization.sessionVersion)
          throw new BadRequestException("Sign in again to connect email");
        const pending = await tx.mailAuthorization.deleteMany({
          where: { stateHash: authorization.stateHash, userId },
        });
        if (!pending.count)
          throw new BadRequestException("Authorization was cancelled; reconnect email");
      }
      await tx.sendingAccount.upsert({
        where: { userId },
        create: { userId, provider, email, credentials: encrypted },
        update: { provider, email, credentials: encrypted },
      });
      await this.audit.record(
        {
          actorId: userId,
          entityType: "SendingAccount",
          entityId: userId,
          action: "MAIL_ACCOUNT_CONNECTED",
          after: { provider, email },
        },
        tx,
      );
    });
  }

  async disconnect(userId: string) {
    await this.activeUser(userId);
    await this.db.$transaction(async (tx) => {
      await tx.sendingAccount.deleteMany({ where: { userId } });
      await tx.mailAuthorization.deleteMany({ where: { userId } });
      await this.audit.record(
        {
          actorId: userId,
          entityType: "SendingAccount",
          entityId: userId,
          action: "MAIL_ACCOUNT_DISCONNECTED",
        },
        tx,
      );
    });
  }

  async send(userId: string, email: RenderedEmail) {
    const actor = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!actor.isActive || !isEmail(actor.email))
      throw new BadRequestException(
        "The notification actor is no longer active or has no valid email",
      );
    const account = await this.db.sendingAccount.findUnique({ where: { userId } });
    if (!account || account.email.toLowerCase() !== actor.email.toLowerCase()) {
      throw new ServiceUnavailableException(
        "Connect your registered sending email before triggering email notifications",
      );
    }
    const credentials = JSON.parse(
      decryptSecret(account.credentials, loadSecretsKey()),
    ) as Credentials;
    const message = {
      from: { name: actor.displayName || actor.email, address: actor.email },
      to: email.to,
      cc: email.cc,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: email.headers,
      disableFileAccess: true,
      disableUrlAccess: true,
    };
    const smtp = SMTP_PROVIDERS[account.provider];
    if (smtp) {
      const transport = nodemailer.createTransport({
        ...smtp,
        secure: smtp.port === 465,
        requireTLS: true,
        auth: { user: account.email, pass: credentials.password },
        connectionTimeout: 15_000,
        socketTimeout: 30_000,
      });
      try {
        await transport.sendMail(message);
      } catch {
        throw new ServiceUnavailableException("Sending failed; check or reconnect your mailbox");
      } finally {
        transport.close();
      }
      return;
    }
    if (!credentials.expiresAt || credentials.expiresAt < Date.now() + 60_000) {
      const tokens = await this.token(account.provider, {
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken!,
      });
      credentials.accessToken = tokens.access_token;
      credentials.refreshToken = tokens.refresh_token ?? credentials.refreshToken;
      credentials.expiresAt = Date.now() + tokens.expires_in * 1000;
      // Compare-and-swap: a concurrent disconnect/reconnect must not be overwritten.
      const saved = await this.db.sendingAccount.updateMany({
        where: { userId: account.userId, credentials: account.credentials },
        data: { credentials: encryptSecret(JSON.stringify(credentials), loadSecretsKey()) },
      });
      if (!saved.count)
        throw new ServiceUnavailableException("Mailbox changed; retry notification");
    }
    const raw = await new MailComposer(message).compile().build();
    const google = account.provider === "google";
    const response = await fetch(
      google
        ? "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
        : "https://graph.microsoft.com/v1.0/me/sendMail",
      {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          authorization: `Bearer ${credentials.accessToken}`,
          "content-type": google ? "application/json" : "text/plain",
        },
        body: google ? JSON.stringify({ raw: raw.toString("base64url") }) : raw.toString("base64"),
      },
    );
    if (!response.ok)
      throw new ServiceUnavailableException("Sending failed; check or reconnect your mailbox");
  }
}
