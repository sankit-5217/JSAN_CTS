import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ShiftsService } from "./shifts.service";

const ACTOR = { actorId: "manager-1", correlationId: "corr-1" };

function baseShift(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "shift-1",
    userId: "eng-1",
    siteId: "site-1",
    label: "Morning",
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: "06:00",
    endTime: "14:00",
    isOnCall: false,
    isActive: true,
    ...overrides,
  };
}

function makeService(
  overrides: {
    findMany?: jest.Mock;
    findUnique?: jest.Mock;
    txUpdate?: jest.Mock;
    userFindUnique?: jest.Mock;
    siteFindUnique?: jest.Mock;
  } = {},
) {
  const txEngineerShift = {
    create: jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ ...baseShift(), ...data })),
    update:
      overrides.txUpdate ??
      jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...baseShift(), ...data })),
  };
  const tx = { engineerShift: txEngineerShift };

  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    engineerShift: {
      findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
      findUnique: overrides.findUnique ?? jest.fn().mockResolvedValue(baseShift()),
    },
    user: {
      findUnique:
        overrides.userFindUnique ??
        jest.fn().mockResolvedValue({ id: "eng-1", displayName: "Sam", role: "SITE_ENGINEER" }),
    },
    site: {
      findUnique: overrides.siteFindUnique ?? jest.fn().mockResolvedValue({ id: "site-1" }),
    },
  } as unknown as PrismaService;

  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  return { service: new ShiftsService(prisma, auditService), prisma, auditService, tx };
}

const CREATE_DTO = {
  userId: "eng-1",
  siteId: "site-1",
  label: "Morning",
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "06:00",
  endTime: "14:00",
};

describe("ShiftsService.create", () => {
  it("creates a shift and audits it", async () => {
    const { service, tx, auditService } = makeService();
    const result = await service.create(CREATE_DTO, ACTOR);

    expect(result).toMatchObject({ label: "Morning", startTime: "06:00" });
    expect(tx.engineerShift.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isOnCall: false }) }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "EngineerShift", action: "CREATE" }),
      tx,
    );
  });

  it.each(["SUPER_ADMIN", "SERVICE_DESK_NOC"])(
    "refuses a shift for a non-engineer (%s)",
    async (role) => {
      const { service, tx } = makeService({
        userFindUnique: jest.fn().mockResolvedValue({ id: "u-1", displayName: "Desk", role }),
      });
      await expect(service.create(CREATE_DTO, ACTOR)).rejects.toThrow(/isn't an engineer/);
      expect(tx.engineerShift.create).not.toHaveBeenCalled();
    },
  );

  it("lets an Infrastructure Lead take a shift", async () => {
    const { service, tx } = makeService({
      userFindUnique: jest
        .fn()
        .mockResolvedValue({ id: "lead-1", displayName: "Lead", role: "INFRASTRUCTURE_LEAD" }),
    });
    await service.create(CREATE_DTO, ACTOR);
    expect(tx.engineerShift.create).toHaveBeenCalled();
  });

  it("rejects an unknown engineer", async () => {
    const { service } = makeService({ userFindUnique: jest.fn().mockResolvedValue(null) });
    await expect(service.create(CREATE_DTO, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects an unknown site", async () => {
    const { service } = makeService({ siteFindUnique: jest.fn().mockResolvedValue(null) });
    await expect(service.create(CREATE_DTO, ACTOR)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a zero-duration window (startTime === endTime)", async () => {
    const { service } = makeService();
    await expect(
      service.create({ ...CREATE_DTO, startTime: "09:00", endTime: "09:00" }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("ShiftsService.update", () => {
  it("404s an unknown shift", async () => {
    const { service } = makeService({ findUnique: jest.fn().mockResolvedValue(null) });
    await expect(service.update("missing", { label: "Evening" }, ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("updates and audits before/after", async () => {
    const { service, tx, auditService } = makeService();
    await service.update("shift-1", { label: "Evening" }, ACTOR);
    expect(tx.engineerShift.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "shift-1" },
        data: expect.objectContaining({ label: "Evening" }),
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "EngineerShift", action: "UPDATE" }),
      tx,
    );
  });

  it("can deactivate a shift without deleting it", async () => {
    const { service, tx } = makeService();
    await service.update("shift-1", { isActive: false }, ACTOR);
    expect(tx.engineerShift.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
    );
  });

  it("rejects a zero-duration window even when only one side changes", async () => {
    const { service } = makeService({
      findUnique: jest.fn().mockResolvedValue(baseShift({ startTime: "09:00", endTime: "17:00" })),
    });
    await expect(service.update("shift-1", { endTime: "09:00" }, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe("ShiftsService.getLiveRoster", () => {
  const NOW = new Date("2026-09-03T10:00:00Z"); // Thursday, 10:00 UTC

  it("splits active shifts into working vs on-call", async () => {
    const { service } = makeService({
      findMany: jest.fn().mockResolvedValue([
        {
          ...baseShift({ id: "s1", daysOfWeek: [4], isOnCall: false }),
          user: { id: "eng-1", displayName: "Sam", email: "sam@corp.example", isActive: true },
          site: { id: "site-1", code: "SITE01", timezone: "UTC" },
        },
        {
          ...baseShift({
            id: "s2",
            userId: "eng-2",
            daysOfWeek: [4],
            startTime: "00:00",
            endTime: "23:59",
            isOnCall: true,
          }),
          user: { id: "eng-2", displayName: "Priya", email: "priya@corp.example", isActive: true },
          site: { id: "site-1", code: "SITE01", timezone: "UTC" },
        },
      ]),
    });

    const roster = await service.getLiveRoster({}, null, NOW);

    expect(roster.working).toEqual([
      expect.objectContaining({ userId: "eng-1", displayName: "Sam", isOnCall: false }),
    ]);
    expect(roster.onCall).toEqual([
      expect.objectContaining({ userId: "eng-2", displayName: "Priya", isOnCall: true }),
    ]);
    expect(roster.asOf).toBe(NOW.toISOString());
  });

  it("excludes a shift whose window doesn't cover now", async () => {
    const { service } = makeService({
      findMany: jest.fn().mockResolvedValue([
        {
          ...baseShift({ startTime: "18:00", endTime: "22:00" }), // not covering 10:00
          user: { id: "eng-1", displayName: "Sam", email: "sam@corp.example", isActive: true },
          site: { id: "site-1", code: "SITE01", timezone: "UTC" },
        },
      ]),
    });
    const roster = await service.getLiveRoster({}, null, NOW);
    expect(roster.working).toEqual([]);
    expect(roster.onCall).toEqual([]);
  });

  it("excludes a shift whose engineer is deactivated", async () => {
    const { service } = makeService({
      findMany: jest.fn().mockResolvedValue([
        {
          ...baseShift(),
          user: { id: "eng-1", displayName: "Sam", email: "sam@corp.example", isActive: false },
          site: { id: "site-1", code: "SITE01", timezone: "UTC" },
        },
      ]),
    });
    const roster = await service.getLiveRoster({}, null, NOW);
    expect(roster.working).toEqual([]);
  });

  it("only queries active shifts, and passes the site filter through", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = makeService({ findMany });
    await service.getLiveRoster({ siteId: "site-9" }, ["site-9", "site-2"], NOW);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.isActive).toBe(true);
    expect(arg.where.siteId).toEqual({ in: ["site-9"] });
  });
});
