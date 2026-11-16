import { SendingMailService } from "./sending-mail.service";
import { MailWorkerGuard } from "./sending-mail.controller";
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
        findUnique: jest.fn(),
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
  it("keeps credentials out of account status", async () => {
    const { db, service } = fixture();
    await service.status("user");
    expect(db.sendingAccount.findUnique).toHaveBeenCalledWith({
      where: { userId: "user" },
      select: { email: true, provider: true, updatedAt: true },
    });
  });
  it("uses single-use hashed state and PKCE, with encrypted verifier and expiry", async () => {
    const { db, service } = fixture();
    const { url } = await service.connect("user", "google");
    const parsed = new URL(url),
      saved = db.mailAuthorization.create.mock.calls[0][0].data;
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
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
  it("rejects a mailbox belonging to a different user", async () => {
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
    await expect(service.callback("google", "state", "code")).rejects.toThrow("same email");
    expect(db.sendingAccount.upsert).not.toHaveBeenCalled();
  });
  it("rejects personal delivery when no mailbox exists", async () => {
    const { service } = fixture();
    await expect(
      service.send("user", { to: [], subject: "", text: "", html: "", headers: {} }),
    ).rejects.toThrow("connect their sending mailbox");
  });
  it("removes credentials and pending authorizations with an audit record", async () => {
    const { db, audit, service } = fixture();
    await service.disconnect("user");
    expect(db.sendingAccount.deleteMany).toHaveBeenCalledWith({ where: { userId: "user" } });
    expect(db.mailAuthorization.deleteMany).toHaveBeenCalledWith({ where: { userId: "user" } });
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
        json: async () => ({ email: "user@example.com", email_verified: true }),
      });
    await service.callback("google", "state", "code");
    const saved = db.sendingAccount.upsert.mock.calls[0][0].create;
    expect(saved.credentials).not.toContain("refresh");
    expect(JSON.parse(decryptSecret(saved.credentials, loadSecretsKey())).refreshToken).toBe(
      "refresh",
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        after: { provider: "google", email: "user@example.com" },
      }),
      db,
    );
  });
  it("refreshes expired access and sends MIME from the actor's actual mailbox", async () => {
    const { db, service } = fixture();
    db.sendingAccount.findUnique.mockResolvedValue({
      userId: "user",
      provider: "google",
      email: "user@example.com",
      credentials: encryptSecret(
        JSON.stringify({ accessToken: "old", refreshToken: "refresh", expiresAt: 1 }),
        loadSecretsKey(),
      ),
      user: { isActive: true, email: "user@example.com", displayName: "Jane" },
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
    const mime = Buffer.from(JSON.parse(calls[1][1].body).raw, "base64url").toString();
    expect(mime).toContain("From: JSAN OpsDesk <user@example.com>");
    expect(
      JSON.parse(
        decryptSecret(
          db.sendingAccount.updateMany.mock.calls[0][0].data.credentials,
          loadSecretsKey(),
        ),
      ).refreshToken,
    ).toBe("rotated");
  });
  it("sends Microsoft mail as JSAN OpsDesk using the triggering user's actual mailbox", async () => {
    const { db, service } = fixture();
    db.sendingAccount.findUnique.mockResolvedValue({
      userId: "user",
      provider: "microsoft",
      email: "engineer@company.example",
      credentials: encryptSecret(
        JSON.stringify({
          accessToken: "access",
          refreshToken: "refresh",
          expiresAt: Date.now() + 3600000,
        }),
        loadSecretsKey(),
      ),
      user: { isActive: true, email: "engineer@company.example", displayName: "Engineer Name" },
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
    expect(mime).toContain("From: JSAN OpsDesk <engineer@company.example>");
    expect(mime).toContain("Cc: reporter@example.com");
    expect(mime).toContain("Comment update");
  });
  it("fails safely when a connection changes during token refresh", async () => {
    const { db, service } = fixture();
    db.sendingAccount.findUnique.mockResolvedValue({
      userId: "user",
      provider: "google",
      email: "user@example.com",
      credentials: encryptSecret(
        JSON.stringify({ refreshToken: "refresh", expiresAt: 1 }),
        loadSecretsKey(),
      ),
      user: { isActive: true, email: "user@example.com" },
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
        json: async () => ({ email: "user@example.com", email_verified: true }),
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
