import { UnauthorizedException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OidcIdentity } from "./oidc/oidc-client.service";
import { SsoLoginRejectedError, SsoService } from "./sso.service";

const ISSUER = "https://idp.example.com/realms/opsdesk";

const identity = (over: Partial<OidcIdentity> = {}): OidcIdentity => ({
  issuer: ISSUER,
  subject: "sub-123",
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
  idpIssuer: null as string | null,
  idpSubject: "seed-admin",
  ...over,
});

function makeService(opts: { linked?: unknown; byEmail?: unknown } = {}) {
  const tx = {
    user: {
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve(user({ ...data }))),
    },
  };
  const prisma = {
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === "function" ? (arg as (t: unknown) => unknown)(tx) : Promise.all(arg as []),
    ),
    user: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(opts.linked ?? null)
        .mockResolvedValueOnce(opts.byEmail ?? null),
    },
    ssoLoginCode: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ user: user() }),
    },
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return { service: new SsoService(prisma, audit), prisma, audit, tx };
}

async function rejection(p: Promise<unknown>): Promise<SsoLoginRejectedError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SsoLoginRejectedError);
  return err as SsoLoginRejectedError;
}

describe("SsoService.resolveUser", () => {
  it("returns an already-linked user by (issuer, subject) without touching email", async () => {
    const linked = user({ idpIssuer: ISSUER, idpSubject: "sub-123", email: "old@example.com" });
    const { service, prisma, audit } = makeService({ linked });

    await expect(service.resolveUser(identity(), "corr-1")).resolves.toBe(linked);
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "USER_SSO_LOGIN",
        entityId: "user-1",
        correlationId: "corr-1",
      }),
    );
  });

  it("links an unlinked pre-provisioned user on first login, audited in the same transaction", async () => {
    const { service, audit, tx } = makeService({ byEmail: user() });

    const result = await service.resolveUser(identity({ email: "ADMIN@example.com" }));

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { idpIssuer: ISSUER, idpSubject: "sub-123" },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "USER_IDP_LINKED",
        before: { idpIssuer: null, idpSubject: "seed-admin" },
        after: { idpIssuer: ISSUER, idpSubject: "sub-123" },
      }),
      tx,
    );
    expect(result.idpSubject).toBe("sub-123");
  });

  it("refuses an email that is already linked to a different identity", async () => {
    const { service, tx, audit } = makeService({
      byEmail: user({ idpIssuer: ISSUER, idpSubject: "someone-else" }),
    });
    const err = await rejection(service.resolveUser(identity()));
    expect(err.reason).toBe("identity_mismatch");
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "USER_SSO_LOGIN_REJECTED", actorId: null }),
    );
  });

  it("refuses users that were never provisioned (no self-registration)", async () => {
    const { service } = makeService();
    expect((await rejection(service.resolveUser(identity()))).reason).toBe("not_provisioned");
  });

  it("refuses an inactive user even when the identity matches", async () => {
    const { service } = makeService({
      linked: user({ idpIssuer: ISSUER, idpSubject: "sub-123", isActive: false }),
    });
    expect((await rejection(service.resolveUser(identity()))).reason).toBe("inactive");
  });

  it("refuses an explicitly unverified email, but accepts an absent email_verified claim", async () => {
    const unverified = makeService({ byEmail: user() });
    expect(
      (await rejection(unverified.service.resolveUser(identity({ emailVerified: false })))).reason,
    ).toBe("email_unverified");

    const absent = makeService({ byEmail: user() });
    await expect(
      absent.service.resolveUser(identity({ emailVerified: undefined })),
    ).resolves.toMatchObject({ id: "user-1" });
  });

  it("refuses an identity with no email when it isn't already linked", async () => {
    const { service } = makeService();
    expect((await rejection(service.resolveUser(identity({ email: null })))).reason).toBe(
      "email_missing",
    );
  });
});

describe("SsoService login codes", () => {
  it("stores only a hash of the code, with a short expiry", async () => {
    const { service, prisma } = makeService();
    const before = Date.now();
    const code = await service.createLoginCode("user-1");

    const data = (prisma.ssoLoginCode.create as jest.Mock).mock.calls[0][0].data;
    expect(code.length).toBeGreaterThanOrEqual(40);
    expect(data.codeHash).not.toContain(code);
    expect(data.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.expiresAt.getTime() - before).toBeLessThanOrEqual(61_000);
  });

  it("redeems a code exactly once", async () => {
    const { service, prisma } = makeService();
    await expect(service.redeemLoginCode("a".repeat(43))).resolves.toMatchObject({ id: "user-1" });

    (prisma.ssoLoginCode.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
    await expect(service.redeemLoginCode("a".repeat(43))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("rejects a valid code whose user has since been deactivated", async () => {
    const { service, prisma } = makeService();
    (prisma.ssoLoginCode.findUnique as jest.Mock).mockResolvedValueOnce({
      user: user({ isActive: false }),
    });
    await expect(service.redeemLoginCode("a".repeat(43))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
