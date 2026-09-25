import { UnauthorizedException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { SocialIdentity } from "./social-provider";
import { SocialIdentityService, SocialLoginRejectedError } from "./social-identity.service";

const identity = (over: Partial<SocialIdentity> = {}): SocialIdentity => ({
  provider: "google",
  issuer: "https://accounts.google.com",
  subject: "g-123",
  email: "admin@example.com",
  emailVerified: true,
  name: "Admin",
  ...over,
});

const user = (over: Record<string, unknown> = {}) => ({
  id: "user-1",
  email: "admin@example.com",
  displayName: "Admin",
  role: UserRole.SUPER_ADMIN,
  isActive: true,
  identities: [] as unknown[],
  ...over,
});

function makeService(opts: { linked?: unknown; byEmail?: unknown } = {}) {
  const tx = {
    userIdentity: { create: jest.fn().mockResolvedValue({}) },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue(user()) },
  };
  const prisma = {
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === "function" ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as []),
    ),
    userIdentity: {
      findUnique: jest.fn().mockResolvedValue(opts.linked ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findFirst: jest.fn().mockResolvedValue(opts.byEmail ?? null) },
    loginHandoffCode: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ user: user() }),
    },
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return { service: new SocialIdentityService(prisma, audit), prisma, audit, tx };
}

async function rejection(p: Promise<unknown>): Promise<SocialLoginRejectedError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SocialLoginRejectedError);
  return err as SocialLoginRejectedError;
}

describe("SocialIdentityService.resolveUser", () => {
  it("returns the user of an already-linked identity, ignoring the email", async () => {
    const { service, prisma, audit } = makeService({
      linked: { user: user({ email: "old@example.com" }) },
    });
    await expect(service.resolveUser(identity(), "c1")).resolves.toMatchObject({ id: "user-1" });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "USER_SOCIAL_LOGIN", after: { provider: "google" } }),
    );
  });

  it("links a first-time identity by verified email, audited in the same transaction", async () => {
    const { service, tx, audit } = makeService({ byEmail: user() });
    await service.resolveUser(identity({ email: "ADMIN@example.com" }));
    expect(tx.userIdentity.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        provider: "google",
        issuer: "https://accounts.google.com",
        subject: "g-123",
        email: "ADMIN@example.com",
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "USER_IDENTITY_LINKED" }),
      tx,
    );
  });

  it("refuses a second account from the same provider for one user", async () => {
    const { service, tx } = makeService({
      byEmail: user({ identities: [{ provider: "google" }] }),
    });
    expect((await rejection(service.resolveUser(identity()))).reason).toBe("identity_mismatch");
    expect(tx.userIdentity.create).not.toHaveBeenCalled();
  });

  it.each([
    ["not_provisioned", {}, identity()],
    ["email_unverified", { byEmail: user() }, identity({ emailVerified: false })],
    ["email_missing", {}, identity({ email: null })],
    ["inactive", { linked: { user: user({ isActive: false }) } }, identity()],
  ])("rejects %s and audits the refusal", async (reason, opts, id) => {
    const { service, audit } = makeService(opts);
    expect((await rejection(service.resolveUser(id))).reason).toBe(reason);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "USER_SOCIAL_LOGIN_REJECTED", actorId: null }),
    );
  });

  it("accepts an absent email_verified claim (single-tenant Microsoft)", async () => {
    const { service } = makeService({ byEmail: user() });
    await expect(
      service.resolveUser(identity({ provider: "microsoft", emailVerified: undefined })),
    ).resolves.toMatchObject({ id: "user-1" });
  });
});

describe("SocialIdentityService handoff codes", () => {
  it("stores only a hash, with a short expiry", async () => {
    const { service, prisma } = makeService();
    const before = Date.now();
    const code = await service.createHandoffCode("user-1");
    const data = (prisma.loginHandoffCode.create as jest.Mock).mock.calls[0][0].data;
    expect(data.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.codeHash).not.toContain(code);
    expect(data.expiresAt.getTime() - before).toBeLessThanOrEqual(61_000);
  });

  it("redeems exactly once, and not for a deactivated user", async () => {
    const { service, prisma } = makeService();
    await expect(service.redeemHandoffCode("a".repeat(43))).resolves.toMatchObject({
      id: "user-1",
    });
    (prisma.loginHandoffCode.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
    await expect(service.redeemHandoffCode("a".repeat(43))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    (prisma.loginHandoffCode.findUnique as jest.Mock).mockResolvedValueOnce({
      user: user({ isActive: false }),
    });
    await expect(service.redeemHandoffCode("b".repeat(43))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
