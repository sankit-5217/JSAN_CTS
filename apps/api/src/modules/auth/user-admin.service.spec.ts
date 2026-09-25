import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Prisma, UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { UserAdminService } from "./user-admin.service";
import { USER_DEACTIVATION_CHECK_EVENT, USER_ROLE_CHANGE_CHECK_EVENT } from "./user-change-checks";

const ACTOR = { actorId: "admin-1", correlationId: "corr-1" };

const row = (over: Record<string, unknown> = {}) => ({
  id: "user-1",
  email: "sam@example.com",
  displayName: "Sam",
  role: UserRole.SITE_ENGINEER,
  isActive: true,
  idpIssuer: null as string | null,
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
  return { service: new UserAdminService(prisma, audit, events), prisma, audit, events, tx };
}

describe("UserAdminService.list / findOne", () => {
  it("never exposes idpIssuer, only whether SSO is linked; site ids sorted", async () => {
    const { service } = makeService({ existing: row({ idpIssuer: "https://idp" }) });
    const view = await service.findOne("user-1");
    expect(view).toMatchObject({ ssoLinked: true, allSites: false, siteIds: ["site-a", "site-b"] });
    expect(view).not.toHaveProperty("idpIssuer");
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
  it("creates with a pending SSO placeholder, site grants, and an audit event", async () => {
    const { service, tx, audit } = makeService();
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
    expect(data.idpSubject).toMatch(/^pending\|[0-9a-f-]{36}$/);
    expect(data.siteAccess).toEqual({ create: [{ siteId: "site-a" }] });
    expect(view).toMatchObject({ email: "new@example.com", ssoLinked: false, siteIds: ["site-a"] });
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

  it("locks the email once the user is SSO-linked, but allows it before", async () => {
    const linked = makeService({ existing: row({ idpIssuer: "https://idp" }) });
    await expect(
      linked.service.update("user-1", { email: "new@example.com" }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);

    const unlinked = makeService();
    await expect(
      unlinked.service.update("user-1", { email: "new@example.com" }, ACTOR),
    ).resolves.toMatchObject({ email: "new@example.com" });
    expect(unlinked.prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: { equals: "new@example.com", mode: "insensitive" }, id: { not: "user-1" } },
      }),
    );
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
