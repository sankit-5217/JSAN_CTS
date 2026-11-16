import { SendingMailService } from "./sending-mail.service";
import { MailWorkerGuard, SendingMailController } from "./sending-mail.controller";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptSecret, encryptSecret, loadSecretsKey } from "../../common/crypto/secret-cipher";
import type { ExecutionContext } from "@nestjs/common";

describe("sending accounts", () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      INTEGRATION_SECRETS_KEY: Buffer.alloc(32, 7).toString("base64"),
      MAIL_SHARED_SENDER_EMAIL: "sankit@jsanconsulting.com",
      MAIL_GOOGLE_CLIENT_ID: "client",
      MAIL_GOOGLE_CLIENT_SECRET: "secret",
      API_PUBLIC_URL: "https://api.example",
    };
  });
  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });
  function fixture() {
    const db = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: "user",
          email: "user@example.com",
          isActive: true,
          sessionVersion: 3,
          role: "SUPER_ADMIN",
        }),
      },
      mailAuthorization: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      sendingAccount: {
        findFirst: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    db.$transaction.mockImplementation(async (fn) => fn(db));
    const audit = { record: jest.fn() };
    return {
      db,
      audit,
      service: new SendingMailService(
        db as unknown as PrismaService,
        audit as unknown as AuditService,
      ),
    };
  }
  const message = {
    to: ["recipient@example.com"],
    subject: "Ticket",
    text: "Update",
    html: "<p>Update</p>",
    headers: {},
  };

  it.each(["CLIENT_MANAGER_VIEWER", "SERVICE_DESK_NOC", "SITE_ENGINEER"])(
    "automatically sends for an active %s without any personal mailbox connection",
    async (role) => {
      const { db, service } = fixture();
      db.user.findUniqueOrThrow.mockResolvedValue({
        id: "actor",
        email: "actor@external.example",
        displayName: "Actor",
        isActive: true,
        role,
      });
      db.sendingAccount.findFirst.mockResolvedValue({
        userId: "shared-admin",
        provider: "microsoft",
        email: "sankit@jsanconsulting.com",
        user: { isActive: true, role: "SUPER_ADMIN", email: "admin@another.example" },
        credentials: encryptSecret(
          JSON.stringify({ accessToken: "shared-access", expiresAt: Date.now() + 3600000 }),
          loadSecretsKey(),
        ),
      });
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      await service.send("actor", message);
      const mime = Buffer.from(
        (global.fetch as jest.Mock).mock.calls[0][1].body,
        "base64",
      ).toString();
      expect(mime).toContain("From: JSAN OpsDesk <sankit@jsanconsulting.com>");
      expect(mime).toContain("Reply-To: Actor <actor@external.example>");
      expect(db.sendingAccount.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            email: { equals: "sankit@jsanconsulting.com", mode: "insensitive" },
            user: { isActive: true, role: "SUPER_ADMIN" },
          },
        }),
      );
    },
  );

  it("uses the shared mailbox for system mail without inventing an actor", async () => {
    const { db, service } = fixture();
    db.sendingAccount.findFirst.mockResolvedValue({
      userId: "shared-admin",
      provider: "microsoft",
      email: "sankit@jsanconsulting.com",
      user: { isActive: true, role: "SUPER_ADMIN" },
      credentials: encryptSecret(
        JSON.stringify({ accessToken: "shared-access", expiresAt: Date.now() + 3600000 }),
        loadSecretsKey(),
      ),
    });
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    await service.send(undefined, message);
    const mime = Buffer.from(
      (global.fetch as jest.Mock).mock.calls[0][1].body,
      "base64",
    ).toString();
    expect(mime).toContain("From: JSAN OpsDesk <sankit@jsanconsulting.com>");
    expect(mime).toContain("Reply-To: sankit@jsanconsulting.com");
    expect(db.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("rejects inactive actors before contacting the provider", async () => {
    const { db, service } = fixture();
    db.user.findUniqueOrThrow.mockResolvedValue({ email: "disabled@example.com", isActive: false });
    global.fetch = jest.fn();
    await expect(service.send("disabled", message)).rejects.toThrow("no longer active");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(["status", "connect", "smtp", "disconnect"] as const)(
    "restricts %s to super admins",
    (method) => {
      const guard = new RolesGuard(new Reflector());
      const context = (role: string) =>
        ({
          getHandler: () => SendingMailController.prototype[method],
          getClass: () => SendingMailController,
          switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
        }) as unknown as ExecutionContext;
      expect(() => guard.canActivate(context("CLIENT_MANAGER_VIEWER"))).toThrow();
      expect(() => guard.canActivate(context("SERVICE_DESK_NOC"))).toThrow();
      expect(guard.canActivate(context("SUPER_ADMIN"))).toBe(true);
    },
  );

  it("rejects a non-admin who attempts to connect or replace the shared mailbox", async () => {
    const { db, service } = fixture();
    db.user.findUniqueOrThrow.mockResolvedValue({
      email: "user@example.com",
      isActive: true,
      role: "SERVICE_DESK_NOC",
    });
    await expect(service.connect("user", "google")).rejects.toThrow("super admin");
    await expect(service.disconnect("user")).rejects.toThrow("super admin");
    expect(db.sendingAccount.deleteMany).not.toHaveBeenCalled();
  });

  it("strips supplied sender and Reply-To headers before delivery", async () => {
    const send = jest.fn();
    const controller = new SendingMailController({ send } as unknown as SendingMailService);
    await controller.deliver({
      userId: "actor",
      email: {
        ...message,
        headers: {
          From: "forged@example.com",
          "Reply-To": "forged@example.com",
          "X-OpsDesk-Entity": "INC-1",
        },
      },
    });
    expect(send).toHaveBeenCalledWith("actor", {
      ...message,
      headers: { "X-OpsDesk-Entity": "INC-1" },
    });
  });
  it("keeps credentials out of account status", async () => {
    const { db, service } = fixture();
    await service.status("user");
    expect(db.sendingAccount.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: "sankit@jsanconsulting.com", mode: "insensitive" },
        user: { isActive: true, role: "SUPER_ADMIN" },
      },
      orderBy: { updatedAt: "desc" },
      select: { email: true, provider: true, updatedAt: true },
    });
  });
  it("uses single-use hashed state and PKCE, with encrypted verifier and expiry", async () => {
    const { db, service } = fixture();
    const { url } = await service.connect("user", "google");
    const parsed = new URL(url),
      saved = db.mailAuthorization.create.mock.calls[0][0].data;
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("login_hint")).toBe("sankit@jsanconsulting.com");
    expect(saved.stateHash).not.toBe(parsed.searchParams.get("state"));
    expect(saved.stateHash).toHaveLength(64);
    expect(saved.verifier.startsWith("v1:")).toBe(true);
    expect(decryptSecret(saved.verifier, loadSecretsKey())).toHaveLength(43);
    expect(saved.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(600000);
  });
  it("rejects unsupported OAuth and SMTP hosts", async () => {
    const { service } = fixture();
    await expect(service.connect("user", "https://private.example")).rejects.toThrow("Unknown");
    await expect(service.connectSmtp("user", "localhost", "password")).rejects.toThrow(
      "Unsupported",
    );
  });
  it("consumes expired authorization without requesting tokens", async () => {
    const { db, service } = fixture();
    db.mailAuthorization.findUnique.mockResolvedValue({
      provider: "google",
      expiresAt: new Date(0),
    });
    global.fetch = jest.fn();
    await expect(service.callback("google", "state", "code")).rejects.toThrow("Expired");
    expect(db.mailAuthorization.updateMany).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("rejects authorization for any mailbox except the configured shared sender", async () => {
    const { db, service } = fixture();
    await service.connect("user", "google");
    db.mailAuthorization.findUnique.mockResolvedValue(
      db.mailAuthorization.create.mock.calls[0][0].data,
    );
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ email: "different@example.com", email_verified: true }),
      });
    await expect(service.callback("google", "state", "code")).rejects.toThrow(
      "configured shared sending email",
    );
    expect(db.sendingAccount.upsert).not.toHaveBeenCalled();
  });
  it("requires one shared connection when no shared mailbox exists", async () => {
    const { service } = fixture();
    await expect(
      service.send("user", { to: [], subject: "", text: "", html: "", headers: {} }),
    ).rejects.toThrow("connect the shared sending mailbox once");
  });
  it("removes credentials and pending authorizations with an audit record", async () => {
    const { db, audit, service } = fixture();
    await service.disconnect("user");
    expect(db.sendingAccount.deleteMany).toHaveBeenCalledWith({
      where: { email: { equals: "sankit@jsanconsulting.com", mode: "insensitive" } },
    });
    expect(db.mailAuthorization.deleteMany).toHaveBeenCalledWith({});
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "MAIL_ACCOUNT_DISCONNECTED", actorId: "user" }),
      db,
    );
  });
  it("encrypts authorized credentials and audits only mailbox metadata", async () => {
    const { db, audit, service } = fixture();
    await service.connect("user", "google");
    db.mailAuthorization.findUnique.mockResolvedValue(
      db.mailAuthorization.create.mock.calls[0][0].data,
    );
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          scope: "openid email https://www.googleapis.com/auth/gmail.send",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ email: "sankit@jsanconsulting.com", email_verified: true }),
      });
    await service.callback("google", "state", "code");
    const saved = db.sendingAccount.upsert.mock.calls[0][0].create;
    expect(saved.credentials).not.toContain("refresh");
    expect(JSON.parse(decryptSecret(saved.credentials, loadSecretsKey())).refreshToken).toBe(
      "refresh",
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        after: { provider: "google", email: "sankit@jsanconsulting.com" },
      }),
      db,
    );
  });
  it("refreshes shared credentials and sends MIME with the actor in Reply-To", async () => {
    const { db, service } = fixture();
    db.sendingAccount.findFirst.mockResolvedValue({
      userId: "shared-admin",
      provider: "google",
      email: "sankit@jsanconsulting.com",
      credentials: encryptSecret(
        JSON.stringify({ accessToken: "old", refreshToken: "refresh", expiresAt: 1 }),
        loadSecretsKey(),
      ),
      user: { isActive: true, role: "SUPER_ADMIN", email: "user@example.com", displayName: "Jane" },
    });
    db.sendingAccount.updateMany.mockResolvedValue({ count: 1 });
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "new", refresh_token: "rotated", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: true });
    await service.send("user", {
      to: ["recipient@example.com"],
      subject: "Ticket",
      text: "Update",
      html: "<p>Update</p>",
      headers: {},
    });
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls[1][0]).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect(calls[1][1].headers.authorization).toBe("Bearer new");
    expect(db.sendingAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "shared-admin", credentials: expect.any(String) },
      }),
    );
    const mime = Buffer.from(JSON.parse(calls[1][1].body).raw, "base64url").toString();
    expect(mime).toContain("From: JSAN OpsDesk <sankit@jsanconsulting.com>");
    expect(mime).toContain('Reply-To: "user@example.com" <user@example.com>');
    expect(
      JSON.parse(
        decryptSecret(
          db.sendingAccount.updateMany.mock.calls[0][0].data.credentials,
          loadSecretsKey(),
        ),
      ).refreshToken,
    ).toBe("rotated");
  });
  it("sends Microsoft mail from the shared sender with the triggering user in Reply-To", async () => {
    const { db, service } = fixture();
    db.sendingAccount.findFirst.mockResolvedValue({
      userId: "shared-admin",
      provider: "microsoft",
      email: "sankit@jsanconsulting.com",
      credentials: encryptSecret(
        JSON.stringify({
          accessToken: "access",
          refreshToken: "refresh",
          expiresAt: Date.now() + 3600000,
        }),
        loadSecretsKey(),
      ),
      user: {
        isActive: true,
        role: "SUPER_ADMIN",
        email: "sankit@jsanconsulting.com",
        displayName: "Engineer Name",
      },
    });
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    await service.send("user", {
      to: ["client@example.com"],
      cc: ["reporter@example.com"],
      subject: "INC-00002[Bug][P3,S3] Issue",
      text: "Comment update",
      html: "<p>Comment update</p>",
      headers: { "X-OpsDesk-Entity": "INC-00002" },
    });
    const [url, request] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(request.headers).toMatchObject({
      authorization: "Bearer access",
      "content-type": "text/plain",
    });
    const mime = Buffer.from(request.body, "base64").toString();
    expect(mime).toContain("From: JSAN OpsDesk <sankit@jsanconsulting.com>");
    expect(mime).toContain('Reply-To: "user@example.com" <user@example.com>');
    expect(mime).toContain("Cc: reporter@example.com");
    expect(mime).toContain("Comment update");
  });
  it("fails safely when a connection changes during token refresh", async () => {
    const { db, service } = fixture();
    db.sendingAccount.findFirst.mockResolvedValue({
      userId: "shared-admin",
      provider: "google",
      email: "sankit@jsanconsulting.com",
      credentials: encryptSecret(
        JSON.stringify({ refreshToken: "refresh", expiresAt: 1 }),
        loadSecretsKey(),
      ),
      user: { isActive: true, role: "SUPER_ADMIN", email: "user@example.com" },
    });
    db.sendingAccount.updateMany.mockResolvedValue({ count: 0 });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "new", expires_in: 3600 }),
    });
    await expect(
      service.send("user", {
        to: ["r@example.com"],
        subject: "Ticket",
        text: "",
        html: "",
        headers: {},
      }),
    ).rejects.toThrow("Mailbox changed");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not restore a mailbox disconnected during OAuth authorization", async () => {
    const { db, service } = fixture();
    await service.connect("user", "google");
    db.mailAuthorization.findUnique.mockResolvedValue(
      db.mailAuthorization.create.mock.calls[0][0].data,
    );
    db.mailAuthorization.deleteMany.mockResolvedValue({ count: 0 });
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          scope: "openid email https://www.googleapis.com/auth/gmail.send",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ email: "sankit@jsanconsulting.com", email_verified: true }),
      });
    await expect(service.callback("google", "state", "code")).rejects.toThrow("cancelled");
    expect(db.sendingAccount.upsert).not.toHaveBeenCalled();
  });
  it("guards internal delivery even when the secret is absent or invalid", () => {
    const guard = new MailWorkerGuard();
    const ctx = (key?: string) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ headers: { "x-mail-worker-key": key } }) }),
      }) as unknown as ExecutionContext;
    delete process.env.MAIL_WORKER_KEY;
    expect(() => guard.canActivate(ctx())).toThrow();
    process.env.MAIL_WORKER_KEY = "x".repeat(32);
    expect(() => guard.canActivate(ctx("bad"))).toThrow();
    expect(guard.canActivate(ctx("x".repeat(32)))).toBe(true);
  });
});
