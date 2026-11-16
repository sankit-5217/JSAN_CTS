import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
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

@Injectable()
export class SendingMailService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private sharedEmail() {
    const email = process.env.MAIL_SHARED_SENDER_EMAIL?.trim().toLowerCase();
    if (!email || !isEmail(email))
      throw new ServiceUnavailableException("Configure the shared sending email address");
    return email;
  }

  private async administrator(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.isActive || user.role !== UserRole.SUPER_ADMIN)
      throw new ForbiddenException("Only a super admin can manage the shared mailbox");
    return user;
  }

  private accountWhere() {
    return {
      email: { equals: this.sharedEmail(), mode: "insensitive" as const },
      user: { isActive: true, role: UserRole.SUPER_ADMIN },
    };
  }

  async status(userId: string) {
    await this.administrator(userId);
    const account = await this.db.sendingAccount.findFirst({
      where: this.accountWhere(),
      orderBy: { updatedAt: "desc" },
      select: { email: true, provider: true, updatedAt: true },
    });
    return {
      account,
      senderEmail: this.sharedEmail(),
      providers: ["google", "microsoft"].map((provider) => {
        try {
          oauthProvider(provider);
          return { provider, configured: true };
        } catch {
          return { provider, configured: false };
        }
      }),
    };
  }

  async connect(userId: string, provider: string) {
    const config = oauthProvider(provider);
    const user = await this.administrator(userId);
    const senderEmail = this.sharedEmail();
    const state = randomBytes(32).toString("base64url");
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
      login_hint: senderEmail,
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

  async callback(provider: string, state: string, code?: string) {
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
    const user = await this.administrator(pending.userId);
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
      email.toLowerCase() !== this.sharedEmail() ||
      (provider === "google" && !profile.email_verified)
    ) {
      throw new BadRequestException("Connect the configured shared sending email address");
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
  }

  async connectSmtp(userId: string, provider: string, password: string) {
    const config = SMTP_PROVIDERS[provider];
    if (!config) throw new BadRequestException("Unsupported SMTP provider");
    await this.administrator(userId);
    const email = this.sharedEmail();
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
      if (
        !user.isActive ||
        user.role !== UserRole.SUPER_ADMIN ||
        this.sharedEmail() !== email.toLowerCase()
      )
        throw new BadRequestException("Account has changed; reconnect email");
      if (authorization) {
        if (user.sessionVersion !== authorization.sessionVersion)
          throw new BadRequestException("Sign in again to connect email");
        const pending = await tx.mailAuthorization.deleteMany({
          where: { stateHash: authorization.stateHash, userId },
        });
        if (!pending.count)
          throw new BadRequestException("Authorization was cancelled; reconnect email");
      }
      await tx.sendingAccount.deleteMany({
        where: {
          email: { equals: this.sharedEmail(), mode: "insensitive" },
          userId: { not: userId },
        },
      });
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
    await this.administrator(userId);
    await this.db.$transaction(async (tx) => {
      await tx.sendingAccount.deleteMany({
        where: { email: { equals: this.sharedEmail(), mode: "insensitive" } },
      });
      // All pending authorizations now target the same shared mailbox.
      await tx.mailAuthorization.deleteMany({});
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

  async send(userId: string | undefined, email: RenderedEmail) {
    const actor = userId
      ? await this.db.user.findUniqueOrThrow({ where: { id: userId } })
      : undefined;
    if (actor && (!actor.isActive || !isEmail(actor.email)))
      throw new BadRequestException(
        "The notification actor is no longer active or has no valid email",
      );
    const account = await this.db.sendingAccount.findFirst({
      where: this.accountWhere(),
      orderBy: { updatedAt: "desc" },
      include: { user: true },
    });
    if (
      !account ||
      !account.user.isActive ||
      account.user.role !== UserRole.SUPER_ADMIN ||
      account.email.toLowerCase() !== this.sharedEmail()
    ) {
      throw new ServiceUnavailableException(
        "A super admin must connect the shared sending mailbox once",
      );
    }
    const credentials = JSON.parse(
      decryptSecret(account.credentials, loadSecretsKey()),
    ) as Credentials;
    const message = {
      from: { name: "JSAN OpsDesk", address: this.sharedEmail() },
      replyTo: actor
        ? { name: actor.displayName || actor.email, address: actor.email }
        : this.sharedEmail(),
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
