import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Prisma, UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PasswordAuthService } from "./password-auth.service";
import { UserAdminService } from "./user-admin.service";
import { USER_DEACTIVATION_CHECK_EVENT, USER_ROLE_CHANGE_CHECK_EVENT } from "./user-change-checks";

const ACTOR = { actorId: "admin-1", correlationId: "corr-1" };

const row = (over: Record<string, unknown> = {}) => ({
  id: "user-1",
  email: "sam@example.com",
  displayName: "Sam",
  role: UserRole.SITE_ENGINEER,
  isActive: true,
  passwordSetAt: null as Date | null,
  lockedUntil: null as Date | null,
  identities: [] as { provider: string }[],
  createdAt: new Date("2026-09-01"),
  updatedAt: new Date("2026-09-01"),
  siteAccess: [{ siteId: "site-b" }, { siteId: "site-a" }],
  ...over,
});

function makeService(opts: { existing?: unknown; clash?: unknown; blockers?: unknown[] } = {}) {
  const tx = {
    user: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve(
          row({
            id: "new-1",
            email: data.email,
            displayName: data.displayName,
            role: data.role,
            siteAccess: data.siteAccess.create,
          }),
        ),
      ),
      update: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve(
            row(Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))),
          ),
        ),
      findUniqueOrThrow: jest.fn().mockResolvedValue(row({ siteAccess: [{ siteId: "site-c" }] })),
    },
    passwordToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    userSiteAccess: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    user: {
      findUnique: jest.fn().mockResolvedValue(opts.existing === undefined ? row() : opts.existing),
      findFirst: jest.fn().mockResolvedValue(opts.clash ?? null),
      findMany: jest.fn().mockResolvedValue([row()]),
    },
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const events = {
    emitAsync: jest.fn().mockResolvedValue(opts.blockers ?? []),
  } as unknown as EventEmitter2;
  const passwords = {
    sendSignInLink: jest.fn().mockResolvedValue({
      link: "http://web/auth/set-password#token=t",
      expiresAt: new Date("2026-09-28"),
      purpose: "INVITE",
      emailQueued: true,
    }),
  } as unknown as PasswordAuthService;
  return {
    service: new UserAdminService(prisma, audit, events, passwords),
    prisma,
    audit,
    events,
    passwords,
    tx,
  };
}

describe("UserAdminService.list / findOne", () => {
  it("reports sign-in methods without exposing secrets; site ids sorted", async () => {
    const { service } = makeService({
      existing: row({
        passwordSetAt: new Date(),
        identities: [{ provider: "github" }, { provider: "google" }],
      }),
    });
    const view = await service.findOne("user-1");
    expect(view).toMatchObject({
      hasPassword: true,
      socialProviders: ["github", "google"],
      lockedUntil: null,
      allSites: false,
      siteIds: ["site-a", "site-b"],
    });
    expect(view).not.toHaveProperty("passwordHash");
    expect(view).not.toHaveProperty("passwordSetAt");
  });

  it("flags all-sites roles", async () => {
    const { service } = makeService({ existing: row({ role: UserRole.AUDITOR_READ_ONLY }) });
    expect((await service.findOne("user-1")).allSites).toBe(true);
  });

  it("filters by status, role and text", async () => {
    const { service, prisma } = makeService();
    await service.list({ status: "inactive", role: UserRole.SITE_ENGINEER, q: " sam " });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: UserRole.SITE_ENGINEER,
          isActive: false,
          OR: [
            { displayName: { contains: "sam", mode: "insensitive" } },
            { email: { contains: "sam", mode: "insensitive" } },
          ],
        },
      }),
    );
  });

  it("404s an unknown user", async () => {
    const { service } = makeService({ existing: null });
    await expect(service.findOne("nope")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("UserAdminService.create", () => {
  it("creates with site grants and an audit event, then emails an invite", async () => {
    const { service, tx, audit, passwords } = makeService();
    const view = await service.create(
      {
        email: "new@example.com",
        displayName: "New",
        role: UserRole.SITE_ENGINEER,
        siteIds: ["site-a"],
      },
      ACTOR,
    );
    const data = tx.user.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("passwordHash");
    expect(data.siteAccess).toEqual({ create: [{ siteId: "site-a" }] });
    expect(view).toMatchObject({
      email: "new@example.com",
      hasPassword: false,
      siteIds: ["site-a"],
      invite: { purpose: "INVITE", emailQueued: true },
    });
    expect(passwords.sendSignInLink).toHaveBeenCalledWith("new-1", ACTOR);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "USER_CREATED",
        actorId: "admin-1",
        correlationId: "corr-1",
      }),
      tx,
    );
  });

  it("refuses a duplicate email (case-insensitive) with 409", async () => {
    const { service, tx } = makeService({ clash: { id: "other" } });
    await expect(
      service.create(
        { email: "sam@example.com", displayName: "X", role: UserRole.SITE_ENGINEER },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it("turns an unknown site id (FK violation) into a 400", async () => {
    const { service, tx } = makeService();
    tx.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "5" }),
    );
    await expect(
      service.create(
        { email: "n@example.com", displayName: "N", role: UserRole.SITE_ENGINEER, siteIds: ["x"] },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("UserAdminService.update", () => {
  it("updates name/role after asking other modules, with before/after audit", async () => {
    const { service, events, audit, tx } = makeService();
    await service.update(
      "user-1",
      { role: UserRole.INFRASTRUCTURE_LEAD, displayName: "Sam K" },
      ACTOR,
    );

    expect(events.emitAsync).toHaveBeenCalledWith(USER_ROLE_CHANGE_CHECK_EVENT, {
      userId: "user-1",
      fromRole: UserRole.SITE_ENGINEER,
      toRole: UserRole.INFRASTRUCTURE_LEAD,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "USER_UPDATED",
        before: expect.objectContaining({ role: UserRole.SITE_ENGINEER, displayName: "Sam" }),
        after: expect.objectContaining({
          role: UserRole.INFRASTRUCTURE_LEAD,
          displayName: "Sam K",
        }),
      }),
      tx,
    );
  });

  it("does not run role checks when the role isn't changing", async () => {
    const { service, events } = makeService();
    await service.update("user-1", { displayName: "Sam K", role: UserRole.SITE_ENGINEER }, ACTOR);
    expect(events.emitAsync).not.toHaveBeenCalled();
  });

  it("refuses a role change another module vetoes, listing every blocker (409)", async () => {
    const blockers = [
      { source: "skills", message: "holds 2 skills", examples: ["Dell", "HPE"] },
      null,
      { source: "shifts", message: "has 1 active shift" },
    ];
    const { service, tx } = makeService({ blockers });
    const err = await service
      .update("user-1", { role: UserRole.SERVICE_DESK_NOC }, ACTOR)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    const body = (err as ConflictException).getResponse() as {
      message: string;
      blockers: unknown[];
    };
    expect(body.message).toBe("Can't change Sam's role: holds 2 skills; has 1 active shift");
    expect(body.blockers).toHaveLength(2);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("refuses changing your own role", async () => {
    const { service } = makeService({
      existing: row({ id: "admin-1", role: UserRole.SUPER_ADMIN }),
    });
    await expect(
      service.update("admin-1", { role: UserRole.AUDITOR_READ_ONLY }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("allows email changes, and kills any pending sign-in link sent to the old address", async () => {
    const { service, prisma, tx } = makeService();
    await expect(
      service.update("user-1", { email: "new@example.com" }, ACTOR),
    ).resolves.toMatchObject({ email: "new@example.com" });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: { equals: "new@example.com", mode: "insensitive" }, id: { not: "user-1" } },
      }),
    );
    expect(tx.passwordToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it("leaves pending links alone when the email doesn't change", async () => {
    const { service, tx } = makeService();
    await service.update("user-1", { displayName: "Sam K" }, ACTOR);
    expect(tx.passwordToken.updateMany).not.toHaveBeenCalled();
  });
});

describe("UserAdminService.sendSignInLink", () => {
  it("delegates for an active user", async () => {
    const { service, passwords } = makeService();
    await expect(service.sendSignInLink("user-1", ACTOR)).resolves.toMatchObject({
      emailQueued: true,
    });
    expect(passwords.sendSignInLink).toHaveBeenCalledWith("user-1", ACTOR);
  });

  it("refuses an inactive user", async () => {
    const { service, passwords } = makeService({ existing: row({ isActive: false }) });
    await expect(service.sendSignInLink("user-1", ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(passwords.sendSignInLink).not.toHaveBeenCalled();
  });
});

describe("UserAdminService.setSites", () => {
  it("adds and removes only the difference, audited with before/after", async () => {
    const { service, tx, audit } = makeService();
    await service.setSites("user-1", { siteIds: ["site-a", "site-c"] }, ACTOR);

    expect(tx.userSiteAccess.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", siteId: { in: ["site-b"] } },
    });
    expect(tx.userSiteAccess.createMany).toHaveBeenCalledWith({
      data: [{ userId: "user-1", siteId: "site-c" }],
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "USER_SITE_ACCESS_CHANGED",
        before: { siteIds: ["site-a", "site-b"] },
        after: { siteIds: ["site-a", "site-c"], added: ["site-c"], removed: ["site-b"] },
      }),
      tx,
    );
  });

  it("is a no-op (no write, no audit) when nothing changes", async () => {
    const { service, prisma, audit } = makeService();
    await service.setSites("user-1", { siteIds: ["site-b", "site-a"] }, ACTOR);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe("UserAdminService.deactivate / reactivate", () => {
  it("deactivates after the incidents check passes, audited", async () => {
    const { service, events, tx, audit } = makeService();
    const view = await service.deactivate("user-1", ACTOR);

    expect(events.emitAsync).toHaveBeenCalledWith(USER_DEACTIVATION_CHECK_EVENT, {
      userId: "user-1",
    });
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "USER_DEACTIVATED", after: { isActive: false } }),
      tx,
    );
    expect(view.isActive).toBe(false);
  });

  it("refuses while the user owns open incidents (409 with the incident numbers)", async () => {
    const { service, tx } = makeService({
      blockers: [
        { source: "incidents", message: "owns 2 open incidents", examples: ["INC-1", "INC-2"] },
      ],
    });
    const err = (await service
      .deactivate("user-1", ACTOR)
      .catch((e: unknown) => e)) as ConflictException;
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({
      blockers: [{ source: "incidents", examples: ["INC-1", "INC-2"] }],
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("refuses deactivating yourself, or someone already inactive", async () => {
    await expect(makeService().service.deactivate("admin-1", ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      makeService({ existing: row({ isActive: false }) }).service.deactivate("user-1", ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("reactivates an inactive user without running checks", async () => {
    const { service, events, audit, tx } = makeService({ existing: row({ isActive: false }) });
    await service.reactivate("user-1", ACTOR);
    expect(events.emitAsync).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "USER_REACTIVATED" }),
      tx,
    );
  });
});
