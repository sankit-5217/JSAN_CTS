import { NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { Request } from "express";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ApiTokensService } from "./api-tokens.service";
import { sha256 } from "./social/social-identity.service";
import { ApiTokenPassportStrategy } from "./strategies/api-token.strategy";

const ACTOR = { actorId: "admin-1", correlationId: "c1" };
const svcUser = {
  id: "svc-1",
  email: "collector@jsan.example",
  role: UserRole.SERVICE_DESK_NOC,
  isActive: true,
};

function makeService(stored: Record<string, unknown> | null = null) {
  const tx = {
    apiToken: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: "tok-1",
          name: data.name,
          prefix: data.prefix,
          createdAt: new Date(),
          expiresAt: data.expiresAt,
          lastUsedAt: null,
          revokedAt: null,
        }),
      ),
      update: jest.fn().mockResolvedValue({ id: "tok-1", revokedAt: new Date() }),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    user: { findUnique: jest.fn().mockResolvedValue({ id: "svc-1" }) },
    apiToken: {
      findUnique: jest.fn().mockResolvedValue(stored),
      findFirst: jest.fn().mockResolvedValue(stored),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return { service: new ApiTokensService(prisma, audit), prisma, audit, tx };
}

const storedRow = (over: Record<string, unknown> = {}) => ({
  id: "tok-1",
  name: "SITE01 collector",
  prefix: "odk_abcdefgh",
  revokedAt: null,
  expiresAt: null,
  lastUsedAt: null,
  user: svcUser,
  ...over,
});

describe("ApiTokensService", () => {
  it("creates an odk_ token, returns it once, stores only its hash, audits", async () => {
    const { service, tx, audit } = makeService();
    const created = await service.create(
      "svc-1",
      { name: "SITE01 collector", expiresInDays: 365 },
      ACTOR,
    );
    expect(created.token).toMatch(/^odk_[\w-]{43}$/);
    const data = tx.apiToken.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(sha256(created.token));
    expect(JSON.stringify(data)).not.toContain(created.token.slice(12));
    expect(data.prefix).toBe(created.token.slice(0, 12));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "API_TOKEN_CREATED", entityId: "svc-1" }),
      tx,
    );
  });

  it("authenticates a live token as its user", async () => {
    const { service, prisma } = makeService(storedRow());
    await expect(service.authenticate("odk_live")).resolves.toEqual(svcUser);
    expect(prisma.apiToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: sha256("odk_live") } }),
    );
    expect(prisma.apiToken.update).toHaveBeenCalled(); // lastUsedAt touched
  });

  it.each([
    ["revoked", storedRow({ revokedAt: new Date() })],
    ["expired", storedRow({ expiresAt: new Date(Date.now() - 1) })],
    ["for an inactive user", storedRow({ user: { ...svcUser, isActive: false } })],
    ["unknown", null],
  ])("rejects a token that is %s", async (_label, row) => {
    const { service } = makeService(row);
    await expect(service.authenticate("odk_x")).resolves.toBeNull();
  });

  it("doesn't rewrite lastUsedAt on every request", async () => {
    const { service, prisma } = makeService(storedRow({ lastUsedAt: new Date() }));
    await service.authenticate("odk_live");
    expect(prisma.apiToken.update).not.toHaveBeenCalled();
  });

  it("revokes, audited; 404 for someone else's token", async () => {
    const { service, audit, tx } = makeService(storedRow());
    await service.revoke("svc-1", "tok-1", ACTOR);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "API_TOKEN_REVOKED" }),
      tx,
    );
    const missing = makeService(null);
    await expect(missing.service.revoke("svc-1", "tok-9", ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("ApiTokenPassportStrategy", () => {
  function run(header: string | undefined, verify: jest.Mock) {
    const strategy = new ApiTokenPassportStrategy(verify);
    const outcome = { success: jest.fn(), fail: jest.fn(), error: jest.fn() };
    Object.assign(strategy, outcome);
    strategy.authenticate({ headers: { authorization: header } } as unknown as Request);
    return outcome;
  }

  it("passes a JWT through (fail, so the jwt strategy runs next)", () => {
    const verify = jest.fn();
    const outcome = run("Bearer eyJhbGciOi.x.y", verify);
    expect(outcome.fail).toHaveBeenCalledWith(401);
    expect(verify).not.toHaveBeenCalled();
  });

  it("succeeds with the token's user", async () => {
    const outcome = run("Bearer odk_abc", jest.fn().mockResolvedValue(svcUser));
    await new Promise(setImmediate);
    expect(outcome.success).toHaveBeenCalledWith(svcUser);
  });

  it("fails an unknown/revoked token", async () => {
    const outcome = run("Bearer odk_abc", jest.fn().mockResolvedValue(null));
    await new Promise(setImmediate);
    expect(outcome.fail).toHaveBeenCalledWith(401);
  });
});
