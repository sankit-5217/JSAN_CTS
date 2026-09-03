import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { UserRole, WorklogActivityType } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { IncidentsService } from "../incidents/incidents.service";
import { WorklogsService } from "./worklogs.service";

const engineer: AuthenticatedUser = {
  id: "engineer-1",
  email: "engineer@example.com",
  role: UserRole.SITE_ENGINEER,
  isActive: true,
};

const otherEngineer: AuthenticatedUser = {
  id: "engineer-2",
  email: "engineer2@example.com",
  role: UserRole.SITE_ENGINEER,
  isActive: true,
};

const lead: AuthenticatedUser = {
  id: "lead-1",
  email: "lead@example.com",
  role: UserRole.INFRASTRUCTURE_LEAD,
  isActive: true,
};

function baseWorklog(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "worklog-1",
    incidentId: "incident-1",
    engineerId: engineer.id,
    activityType: WorklogActivityType.REMOTE_WORK,
    startedAt: new Date("2026-09-03T09:00:00Z"),
    endedAt: null,
    durationMinutes: null,
    billable: null,
    notes: null,
    editReason: null,
    createdAt: new Date("2026-09-03T09:00:00Z"),
    updatedAt: new Date("2026-09-03T09:00:00Z"),
    ...overrides,
  };
}

function makeService(
  overrides: {
    worklogFindUnique?: jest.Mock;
    txWorklog?: Partial<Record<string, jest.Mock>>;
    findOneScoped?: jest.Mock;
  } = {},
) {
  const txWorklog = {
    create: jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ ...baseWorklog(), ...data })),
    update: jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ ...baseWorklog(), ...data })),
    ...overrides.txWorklog,
  };
  const tx = {
    worklog: txWorklog,
    incidentEvent: {
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: "event-1", ...data })),
    },
  };

  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    worklog: {
      findUnique: overrides.worklogFindUnique ?? jest.fn().mockResolvedValue(baseWorklog()),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;

  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const incidentsService = {
    findOneScoped:
      overrides.findOneScoped ??
      jest.fn().mockResolvedValue({ id: "incident-1", siteId: "site-a" }),
  } as unknown as IncidentsService;

  return {
    service: new WorklogsService(prisma, auditService, incidentsService),
    prisma,
    auditService,
    incidentsService,
    tx,
  };
}

const baseCreateDto = {
  activityType: WorklogActivityType.REMOTE_WORK,
  startedAt: new Date("2026-09-03T09:00:00Z"),
};

describe("WorklogsService.create", () => {
  it("delegates site scope to IncidentsService before creating", async () => {
    const { service, incidentsService } = makeService();
    await service.create("incident-1", baseCreateDto, { actorId: engineer.id }, engineer);
    expect(incidentsService.findOneScoped).toHaveBeenCalledWith("incident-1", engineer);
  });

  it("leaves durationMinutes null when endedAt is omitted (activity still in progress)", async () => {
    const { service, tx } = makeService();
    await service.create("incident-1", baseCreateDto, { actorId: engineer.id }, engineer);
    expect(tx.worklog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ durationMinutes: null }) }),
    );
  });

  it("derives durationMinutes from startedAt/endedAt", async () => {
    const { service, tx } = makeService();
    await service.create(
      "incident-1",
      { ...baseCreateDto, endedAt: new Date("2026-09-03T09:45:00Z") },
      { actorId: engineer.id },
      engineer,
    );
    expect(tx.worklog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ durationMinutes: 45 }) }),
    );
  });

  it("rejects endedAt before startedAt", async () => {
    const { service } = makeService();
    await expect(
      service.create(
        "incident-1",
        { ...baseCreateDto, endedAt: new Date("2026-09-03T08:00:00Z") },
        { actorId: engineer.id },
        engineer,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("writes both the timeline event and the audit record", async () => {
    const { service, tx, auditService } = makeService();
    await service.create("incident-1", baseCreateDto, { actorId: engineer.id }, engineer);
    expect(tx.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: "WORKLOG" }) }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "Worklog", action: "CREATE" }),
      tx,
    );
  });
});

describe("WorklogsService.correct", () => {
  it("allows the original engineer to correct their own worklog", async () => {
    const { service, tx } = makeService();
    const result = await service.correct(
      "worklog-1",
      { editReason: "Fixed end time" },
      { actorId: engineer.id },
      engineer,
    );
    expect(result).toBeDefined();
    expect(tx.worklog.update).toHaveBeenCalledTimes(1);
  });

  it("allows an elevated role to correct someone else's worklog", async () => {
    const { service } = makeService();
    await expect(
      service.correct("worklog-1", { editReason: "Lead correction" }, { actorId: lead.id }, lead),
    ).resolves.toBeDefined();
  });

  it("rejects a non-owner, non-elevated engineer", async () => {
    const { service } = makeService();
    await expect(
      service.correct(
        "worklog-1",
        { editReason: "Sneaky edit" },
        { actorId: otherEngineer.id },
        otherEngineer,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("recomputes durationMinutes when endedAt changes", async () => {
    const { service, tx } = makeService();
    await service.correct(
      "worklog-1",
      { endedAt: new Date("2026-09-03T10:00:00Z"), editReason: "Actual finish was later" },
      { actorId: engineer.id },
      engineer,
    );
    expect(tx.worklog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ durationMinutes: 60 }) }),
    );
  });

  it("writes before/after audit and a WORKLOG timeline event for the correction", async () => {
    const { service, tx, auditService } = makeService();
    await service.correct(
      "worklog-1",
      { editReason: "Fixed end time" },
      { actorId: engineer.id },
      engineer,
    );
    expect(tx.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "WORKLOG",
          payload: expect.objectContaining({ action: "CORRECTION" }),
        }),
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "Worklog", action: "CORRECT" }),
      tx,
    );
  });
});
