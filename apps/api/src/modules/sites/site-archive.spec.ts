import { BadRequestException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertSiteAcceptsNewWork, SITE_ARCHIVE_CHECK_EVENT } from "./site-status";
import { SitesService } from "./sites.service";

const ACTOR = { actorId: "admin-1", correlationId: "corr-1" };
const site = (status = "ACTIVE") => ({
  id: "site-1",
  code: "SITE09",
  name: "Old office",
  timezone: "Asia/Kolkata",
  is247: false,
  status,
});

function make(opts: { status?: string; blockers?: unknown[] } = {}) {
  const tx = {
    site: {
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...site(), ...data })),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    site: {
      findUnique: jest.fn().mockResolvedValue(site(opts.status)),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const events = { emitAsync: jest.fn().mockResolvedValue(opts.blockers ?? [null]) };
  return { service: new SitesService(prisma, audit, events as never), prisma, audit, events, tx };
}

describe("Delete site = archive (rubric T9–T11)", () => {
  it("asks the other modules first, then archives and audits in one transaction", async () => {
    const { service, events, tx, audit } = make();
    const after = await service.archive("site-1", ACTOR);
    expect(events.emitAsync).toHaveBeenCalledWith(SITE_ARCHIVE_CHECK_EVENT, { siteId: "site-1" });
    expect(tx.site.update).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: { status: "ARCHIVED" },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SITE_ARCHIVED",
        entityType: "Site",
        before: { status: "ACTIVE" },
        after: { status: "ARCHIVED" },
        actorId: "admin-1",
      }),
      tx,
    );
    expect(after.status).toBe("ARCHIVED");
  });

  it("is refused with the reasons (and ticket numbers) while another module objects", async () => {
    const blocker = {
      source: "incidents",
      message: "it has 2 open tickets",
      examples: ["INC-1", "INC-2"],
    };
    const { service, tx } = make({ blockers: [blocker, null] });
    const err = await service.archive("site-1", ACTOR).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ blockers: [blocker] });
    expect(tx.site.update).not.toHaveBeenCalled();
  });

  it("archiving twice is a no-op", async () => {
    const { service, events, tx } = make({ status: "ARCHIVED" });
    await service.archive("site-1", ACTOR);
    expect(events.emitAsync).not.toHaveBeenCalled();
    expect(tx.site.update).not.toHaveBeenCalled();
  });

  it("restore brings it back and is audited", async () => {
    const { service, tx, audit } = make({ status: "ARCHIVED" });
    const after = await service.restore("site-1", ACTOR);
    expect(after.status).toBe("ACTIVE");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SITE_RESTORED" }),
      tx,
    );
  });

  it("lists leave archived sites out unless asked", async () => {
    const { service, prisma } = make();
    await service.findAll({ limit: 50, offset: 0 }, null);
    expect((prisma.site.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      status: { not: "ARCHIVED" },
    });
    await service.findAll({ limit: 50, offset: 0, includeArchived: true }, ["site-1"]);
    expect((prisma.site.findMany as jest.Mock).mock.calls[1][0].where).toEqual({
      id: { in: ["site-1"] },
    });
  });
});

describe("assertSiteAcceptsNewWork (rubric T12)", () => {
  const reader = (status: string | null) => ({
    site: {
      findUnique: jest.fn().mockResolvedValue(status ? { code: "SITE09", status } : null),
    },
  });

  it("refuses new work on an archived site", async () => {
    await expect(assertSiteAcceptsNewWork(reader("ARCHIVED"), "site-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("lets active and unknown sites through (unknown is the caller's 404)", async () => {
    await expect(assertSiteAcceptsNewWork(reader("ACTIVE"), "site-1")).resolves.toBeUndefined();
    await expect(assertSiteAcceptsNewWork(reader(null), "site-1")).resolves.toBeUndefined();
  });
});
