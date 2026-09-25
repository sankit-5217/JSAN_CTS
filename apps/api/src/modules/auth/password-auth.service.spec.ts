import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UserRole } from "@prisma/client";
import { AccountMailPublisher } from "../../common/notifications/account-mail.publisher";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { hashPassword, verifyPassword } from "./password-hasher";
import { LOCKOUT_MS, MAX_FAILED_LOGINS, PasswordAuthService } from "./password-auth.service";
import { sha256 } from "./social/social-identity.service";

// scrypt is deliberately slow (~32 MiB, tens of ms per hash); under a fully
// parallel `pnpm test` on a busy machine the 5s default can be too tight.
jest.setTimeout(30_000);

const PASSWORD = "rack four cable green";
let HASH: string;
beforeAll(async () => {
  HASH = await hashPassword(PASSWORD);
});

const user = (over: Record<string, unknown> = {}) => ({
  id: "user-1",
  email: "sam@example.com",
  displayName: "Sam",
  role: UserRole.SITE_ENGINEER,
  isActive: true,
  passwordHash: HASH,
  passwordSetAt: new Date(),
  failedLoginCount: 0,
  lockedUntil: null as Date | null,
  sessionVersion: 3,
  ...over,
});

function makeService(opts: { found?: unknown; token?: unknown; emailQueued?: boolean } = {}) {
  const tx = {
    passwordToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({}),
    },
    user: {
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...user(), ...data })),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    user: {
      findFirst: jest.fn().mockResolvedValue(opts.found === undefined ? user() : opts.found),
      findUnique: jest.fn().mockResolvedValue({ displayName: "Admin", email: "admin@example.com" }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue(opts.found === undefined ? user() : opts.found),
      update: jest.fn().mockResolvedValue({}),
    },
    passwordToken: {
      findUnique: jest.fn().mockResolvedValue(opts.token ?? null),
    },
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const mail = {
    send: jest.fn().mockResolvedValue(opts.emailQueued ?? true),
  } as unknown as AccountMailPublisher;
  const config = {
    get: jest.fn((k: string) => (k === "WEB_APP_URL" ? "https://opsdesk.example" : undefined)),
  } as unknown as ConfigService;
  return { service: new PasswordAuthService(prisma, audit, mail, config), prisma, audit, mail, tx };
}

describe("PasswordAuthService.login", () => {
  it("signs in with the right password and audits it", async () => {
    const { service, audit } = makeService();
    await expect(service.login("sam@example.com", PASSWORD, "c1")).resolves.toMatchObject({
      id: "user-1",
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "USER_PASSWORD_LOGIN", actorId: "user-1" }),
    );
  });

  it("gives the same answer for unknown email, no password yet, and wrong password", async () => {
    const messages: string[] = [];
    for (const found of [null, user({ passwordHash: null }), user()]) {
      const { service } = makeService({ found });
      const err = (await service
        .login("sam@example.com", "wrong password!!", undefined)
        .catch((e: unknown) => e)) as UnauthorizedException;
      expect(err).toBeInstanceOf(UnauthorizedException);
      messages.push(err.message);
    }
    expect(new Set(messages)).toEqual(new Set(["Invalid email or password"]));
  });

  it("counts failures and locks the account on the fifth", async () => {
    const { service, prisma, audit } = makeService({
      found: user({ failedLoginCount: MAX_FAILED_LOGINS - 1 }),
    });
    const before = Date.now();
    await expect(service.login("sam@example.com", "wrong password!!")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const data = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
    expect(data.failedLoginCount).toBe(0);
    expect(data.lockedUntil.getTime()).toBeGreaterThanOrEqual(before + LOCKOUT_MS - 1000);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "USER_LOCKED_OUT" }),
    );
  });

  it("refuses a locked account even with the right password", async () => {
    const { service } = makeService({
      found: user({ lockedUntil: new Date(Date.now() + 60_000) }),
    });
    await expect(service.login("sam@example.com", PASSWORD)).rejects.toThrow(/Too many failed/);
  });

  it("clears the failure count after a successful sign-in", async () => {
    const { service, prisma } = makeService({ found: user({ failedLoginCount: 2 }) });
    await service.login("sam@example.com", PASSWORD);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  });

  it("says 'deactivated' only after the password was right", async () => {
    const { service } = makeService({ found: user({ isActive: false }) });
    await expect(service.login("sam@example.com", PASSWORD)).rejects.toThrow(/deactivated/);
    await expect(service.login("sam@example.com", "wrong password!!")).rejects.toThrow(
      "Invalid email or password",
    );
  });
});

describe("PasswordAuthService.sendSignInLink", () => {
  it("sends an INVITE to someone without a password, storing only the token hash", async () => {
    const { service, tx, mail } = makeService({ found: user({ passwordHash: null }) });
    const result = await service.sendSignInLink("user-1", { actorId: "admin-1" });

    expect(result.purpose).toBe("INVITE");
    expect(result.emailQueued).toBe(true);
    expect(result.link).toMatch(
      /^https:\/\/opsdesk\.example\/auth\/set-password#token=[\w-]{40,}$/,
    );
    const token = result.link.split("#token=")[1];
    const created = tx.passwordToken.create.mock.calls[0][0].data;
    expect(created.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(created)).not.toContain(token);
    // earlier unused links are killed first
    expect(tx.passwordToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "ACCOUNT_INVITE",
        link: result.link,
        invitedBy: { name: "Admin", email: "admin@example.com" },
      }),
    );
  });

  it("sends a RESET (1 hour) to someone who already has a password", async () => {
    const { service, mail } = makeService();
    const before = Date.now();
    const result = await service.sendSignInLink("user-1", { actorId: null });
    expect(result.purpose).toBe("RESET");
    expect(result.expiresAt.getTime() - before).toBeLessThanOrEqual(3600_000 + 1000);
    expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "PASSWORD_RESET" }));
  });

  it("reports when the email couldn't be queued", async () => {
    const { service } = makeService({ emailQueued: false });
    await expect(service.sendSignInLink("user-1", { actorId: "a" })).resolves.toMatchObject({
      emailQueued: false,
    });
  });
});

describe("PasswordAuthService.requestReset", () => {
  it("does nothing (and reveals nothing) for an unknown email", async () => {
    const { service, mail } = makeService({ found: null });
    await expect(service.requestReset("nobody@example.com")).resolves.toBeUndefined();
    expect(mail.send).not.toHaveBeenCalled();
  });
});

describe("PasswordAuthService.setPassword", () => {
  const token = "t".repeat(43);
  const tokenRow = (over: Record<string, unknown> = {}) => ({
    id: "tok-1",
    userId: "user-1",
    purpose: "INVITE",
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: user({ passwordHash: null }),
    ...over,
  });

  it("hashes the new password, consumes the link and signs out other sessions", async () => {
    const { service, tx, audit } = makeService({ token: tokenRow() });
    const result = await service.setPassword(token, "a brand new passphrase");

    const data = tx.user.update.mock.calls[0][0].data;
    expect(data.sessionVersion).toEqual({ increment: 1 });
    expect(data.lockedUntil).toBeNull();
    await expect(verifyPassword("a brand new passphrase", data.passwordHash)).resolves.toBe(true);
    expect(tx.passwordToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "tok-1", usedAt: null }) }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "USER_PASSWORD_SET", after: { via: "INVITE" } }),
      tx,
    );
    expect(result.id).toBe("user-1");
  });

  it("enforces the password policy before consuming the link", async () => {
    const { service, tx } = makeService({ token: tokenRow() });
    await expect(service.setPassword(token, "short")).rejects.toThrow(/at least 12/);
    expect(tx.passwordToken.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown", null],
    ["used", tokenRow({ usedAt: new Date() })],
    ["expired", tokenRow({ expiresAt: new Date(Date.now() - 1) })],
  ])("rejects an %s link", async (_label, row) => {
    const { service } = makeService({ token: row });
    await expect(service.setPassword(token, "a brand new passphrase")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("loses a race cleanly when the link is used concurrently", async () => {
    const { service, tx } = makeService({ token: tokenRow() });
    tx.passwordToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.setPassword(token, "a brand new passphrase")).rejects.toThrow(
      /expired or was already used/,
    );
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
