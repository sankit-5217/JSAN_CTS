import { SendingMailService } from "./sending-mail.service";
import { MailWorkerGuard, SendingMailController } from "./sending-mail.controller";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptSecret, encryptSecret, loadSecretsKey } from "../../common/crypto/secret-cipher";
import type { ExecutionContext } from "@nestjs/common";
import type { Response } from "express";

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
          displayName: "User",
          isActive: true,
          sessionVersion: 3,
          role: "SUPER_ADMIN",
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: "user",
          email: "user@example.com",
          displayName: "User",
          isActive: true,
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
  const message = {
    to: ["recipient@example.com"],
    subject: "Ticket",
    text: "Update",
    html: "<p>Update</p>",
    headers: {},
  };

  it.each(["CLIENT_MANAGER_VIEWER", "SERVICE_DESK_NOC", "SITE_ENGINEER"])(
    "sends an active %s from their own registered mailbox",
    async (role) => {
      const { db, service } = fixture();
      db.user.findUniqueOrThrow.mockResolvedValue({
        id: "actor",
        email: "actor@external.example",
        displayName: "Actor",
        isActive: true,
        role,
      });
      db.sendingAccount.findUnique.mockResolvedValue({
        userId: "actor",
        provider: "microsoft",
        email: "actor@external.example",
        credentials: encryptSecret(
          JSON.stringify({ accessToken: "personal-access", expiresAt: Date.now() + 3600000 }),
          loadSecretsKey(),
        ),
      });
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      await service.send("actor", message);
      const mime = Buffer.from(
        (global.fetch as jest.Mock).mock.calls[0][1].body,
        "base64",
      ).toString();
      expect(mime).toContain("From: Actor <actor@external.example>");
      expect(mime).not.toContain("Reply-To:");
      expect(db.sendingAccount.findUnique).toHaveBeenCalledWith({ where: { userId: "actor" } });
    },
  );

  it("does not send a user-triggered email without that user's mailbox", async () => {
    const { service } = fixture();
    global.fetch = jest.fn();
    await expect(service.send("user", message)).rejects.toThrow("Connect your registered");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a previously connected shared mailbox that does not match the updater", async () => {
    const { db, service } = fixture();
    db.sendingAccount.findUnique.mockResolvedValue({
      userId: "user",
      email: "sankit@jsanconsulting.com",
      provider: "microsoft",
    });
    global.fetch = jest.fn();
    await expect(service.send("user", message)).rejects.toThrow("Connect your registered");
    expect(global.fetch).not.toHaveBeenCalled();
    const status = await service.status("user");
    expect(status.account).toBeNull();
    expect(status.senderEmail).toBe("user@example.com");
  });

  it("rejects inactive actors before contacting the provider", async () => {
    const { db, service } = fixture();
    db.user.findUniqueOrThrow.mockResolvedValue({ email: "disabled@example.com", isActive: false });
    global.fetch = jest.fn();
    await expect(service.send("disabled", message)).rejects.toThrow("no longer active");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("allows any active account to manage its own mailbox", async () => {
    const { db, service } = fixture();
    db.user.findUniqueOrThrow.mockResolvedValue({
      id: "user",
      email: "user@example.com",
      isActive: true,
      role: "SERVICE_DESK_NOC",
    });
    expect(await service.connect("user", "google")).toHaveProperty("url");
    await service.disconnect("user");
    expect(db.sendingAccount.deleteMany).toHaveBeenCalledWith({ where: { userId: "user" } });
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
    expect(parsed.searchParams.get("login_hint")).toBe("user@example.com");
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
  it("rejects authorization for any mailbox except the user's registered email", async () => {
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
      "registered to your OpsDesk account",
    );
    expect(db.sendingAccount.upsert).not.toHaveBeenCalled();
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
  it("refreshes the user's credentials and sends MIME from their registered address", async () => {
    const { db, service } = fixture();
    db.sendingAccount.findUnique.mockResolvedValue({
      userId: "user",
      provider: "google",
      email: "user@example.com",
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
      expect.objectContaining({ where: { userId: "user", credentials: expect.any(String) } }),
    );
    const mime = Buffer.from(JSON.parse(calls[1][1].body).raw, "base64url").toString();
    expect(mime).toContain("From: User <user@example.com>");
    expect(
      JSON.parse(
        decryptSecret(
          db.sendingAccount.updateMany.mock.calls[0][0].data.credentials,
          loadSecretsKey(),
        ),
      ).refreshToken,
    ).toBe("rotated");
  });
  it("sends Microsoft mail from the triggering user's registered email", async () => {
    const { db, service } = fixture();
    db.sendingAccount.findUnique.mockResolvedValue({
      userId: "user",
      provider: "microsoft",
      email: "user@example.com",
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
        email: "user@example.com",
        displayName: "User",
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
    expect(mime).toContain("From: User <user@example.com>");
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

  it("offers app-password providers to every user, not only OAuth ones", async () => {
    const { service } = fixture();
    const status = await service.status("user");
    expect(status.smtpProviders.map((p) => p.provider)).toEqual(["yahoo", "icloud", "zoho"]);
  });

  const statePath = (url: string) => {
    const state = new URL(url).searchParams.get("state")!;
    return Buffer.from(state.split(".")[1], "base64url").toString("utf8");
  };

  it.each([
    ["CLIENT_MANAGER_VIEWER", "/client/home"],
    ["SERVICE_DESK_NOC", "/"],
    ["SITE_ENGINEER", "/"],
    ["SUPER_ADMIN", "/"],
  ])("sends a %s back to their own home after connecting", async (role, expected) => {
    const { db, service } = fixture();
    db.user.findUniqueOrThrow.mockResolvedValue({
      id: "user",
      email: "user@example.com",
      displayName: "User",
      isActive: true,
      sessionVersion: 3,
      role,
    });
    const { url } = await service.connect("user", "google");
    expect(statePath(url)).toBe(expected);
  });

  it("ignores a return path that is not one of ours", async () => {
    const { service } = fixture();
    const { url } = await service.connect("user", "google", "https://evil.example/steal");
    expect(statePath(url)).toBe("/");
  });

  it("returns the user to the page they started the connection from", async () => {
    const { db, service } = fixture();
    const { url } = await service.connect("user", "google", "/account/email");
    const state = new URL(url).searchParams.get("state")!;
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
    await expect(service.callback("google", state, "code")).resolves.toBe("/account/email");
  });

  it("redirects a finished connection to the user's own home, with no extra page", async () => {
    const callback = jest.fn().mockResolvedValue("/client/home");
    const controller = new SendingMailController({ callback } as unknown as SendingMailService);
    const response = { setHeader: jest.fn(), redirect: jest.fn() };
    await controller.callback("google", "nonce.path", "code", response as unknown as Response);
    expect(response.redirect).toHaveBeenCalledWith(
      expect.stringContaining("/client/home?result=connected"),
    );
    expect(response.redirect).not.toHaveBeenCalledWith(expect.stringContaining("/account/email"));
  });

  it("brings a failed connection back to the same place, so it can be retried", async () => {
    const callback = jest.fn().mockRejectedValue(new Error("refused"));
    const controller = new SendingMailController({ callback } as unknown as SendingMailService);
    const response = { setHeader: jest.fn(), redirect: jest.fn() };
    await controller.callback("google", "nonce.path", undefined, response as unknown as Response);
    expect(response.redirect).toHaveBeenCalledWith(expect.stringContaining("result=failed"));
  });
});
