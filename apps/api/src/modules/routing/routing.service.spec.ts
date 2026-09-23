import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthzService } from "../auth/authz.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { IncidentsService } from "../incidents/incidents.service";
import { RosterEntry, ShiftsService } from "../shifts/shifts.service";
import { SkillsService } from "../skills/skills.service";
import { RoutingService } from "./routing.service";

const USER = { id: "desk-1", role: UserRole.SERVICE_DESK_NOC } as AuthenticatedUser;
const NOW = new Date("2026-09-23T08:00:00Z");

const STORAGE = { id: "skill-storage", name: "Storage" };
const BACKUP = { id: "skill-backup", name: "Backup" };

function incident(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "inc-1",
    siteId: "site-1",
    category: "Storage",
    status: "NEW",
    ownerUserId: null,
    ...overrides,
  };
}

function rosterEntry(userId: string, overrides: Partial<RosterEntry> = {}): RosterEntry {
  return {
    shiftId: `shift-${userId}`,
    label: "Morning",
    isOnCall: false,
    siteId: "site-1",
    siteCode: "SITE01",
    userId,
    displayName: userId,
    email: `${userId}@example.com`,
    ...overrides,
  };
}

function makeService(opts: {
  incident?: ReturnType<typeof incident>;
  findOneScoped?: jest.Mock;
  required?: { id: string; name: string }[];
  working?: RosterEntry[];
  onCall?: RosterEntry[];
  skills?: Record<string, string[]>;
  workload?: Record<string, number>;
  policy?: { id: string; autoAssignEnabled: boolean } | null;
  autoAssign?: jest.Mock;
  canAccessSite?: boolean;
}) {
  const tx = {
    routingPolicy: {
      upsert: jest
        .fn()
        .mockImplementation(({ create }) => Promise.resolve({ id: "policy-1", ...create })),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    routingPolicy: { findUnique: jest.fn().mockResolvedValue(opts.policy ?? null) },
    site: { findUnique: jest.fn().mockResolvedValue({ id: "site-1" }) },
  } as unknown as PrismaService;
  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const authzService = {
    canAccessSite: jest.fn().mockResolvedValue(opts.canAccessSite ?? true),
  } as unknown as AuthzService;
  const incidentsService = {
    findOne: jest.fn().mockResolvedValue(opts.incident ?? incident()),
    autoAssign: opts.autoAssign ?? jest.fn().mockResolvedValue({ id: "inc-1" }),
    findOneScoped: opts.findOneScoped ?? jest.fn().mockResolvedValue(opts.incident ?? incident()),
    countOpenOwnedBy: jest.fn().mockResolvedValue(new Map(Object.entries(opts.workload ?? {}))),
  } as unknown as IncidentsService;
  const shiftsService = {
    getLiveRoster: jest.fn().mockResolvedValue({
      asOf: NOW.toISOString(),
      working: opts.working ?? [],
      onCall: opts.onCall ?? [],
    }),
  } as unknown as ShiftsService;
  const skillsService = {
    findRequiredSkillsForCategory: jest.fn().mockResolvedValue(opts.required ?? [STORAGE]),
    findSkillIdsByUser: jest
      .fn()
      .mockResolvedValue(
        new Map(Object.entries(opts.skills ?? {}).map(([u, ids]) => [u, new Set(ids)])),
      ),
  } as unknown as SkillsService;

  return {
    service: new RoutingService(
      prisma,
      auditService,
      authzService,
      incidentsService,
      shiftsService,
      skillsService,
    ),
    prisma,
    auditService,
    incidentsService,
    shiftsService,
    tx,
  };
}

describe("RoutingService.suggestForIncident", () => {
  it("propagates the scoped fetch's access denial", async () => {
    const { service } = makeService({
      findOneScoped: jest.fn().mockRejectedValue(new ForbiddenException()),
    });
    await expect(service.suggestForIncident("inc-1", USER, NOW)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("returns INCIDENT_NOT_OPEN for a closed incident", async () => {
    const { service, shiftsService } = makeService({ incident: incident({ status: "CLOSED" }) });
    const result = await service.suggestForIncident("inc-1", USER, NOW);

    expect(result.reason).toBe("INCIDENT_NOT_OPEN");
    expect(result.candidates).toEqual([]);
    expect(shiftsService.getLiveRoster).not.toHaveBeenCalled();
  });

  it("returns NO_SKILL_REQUIREMENTS when the category has none configured", async () => {
    const { service } = makeService({ required: [] });
    const result = await service.suggestForIncident("inc-1", USER, NOW);
    expect(result.reason).toBe("NO_SKILL_REQUIREMENTS");
  });

  it("reads the live roster for the incident's own site only", async () => {
    const { service, shiftsService } = makeService({});
    const result = await service.suggestForIncident("inc-1", USER, NOW);

    expect(shiftsService.getLiveRoster).toHaveBeenCalledWith({ siteId: "site-1" }, null, NOW);
    expect(result.reason).toBe("NO_ENGINEERS_ON_SHIFT");
  });

  it("requires every skill and lists the ones nobody on shift holds", async () => {
    const { service } = makeService({
      required: [STORAGE, BACKUP],
      working: [rosterEntry("eng-a"), rosterEntry("eng-b")],
      skills: { "eng-a": [STORAGE.id], "eng-b": [] },
    });
    const result = await service.suggestForIncident("inc-1", USER, NOW);

    expect(result.reason).toBe("NO_QUALIFIED_ENGINEER");
    expect(result.candidates).toEqual([]);
    expect(result.uncoveredSkills).toEqual([BACKUP]);
  });

  it("ranks qualified engineers by open workload, then name", async () => {
    const { service } = makeService({
      working: [
        rosterEntry("zed"),
        rosterEntry("amy"),
        rosterEntry("bob"),
        rosterEntry("unskilled"),
      ],
      skills: { zed: [STORAGE.id], amy: [STORAGE.id], bob: [STORAGE.id] },
      workload: { amy: 3 },
    });
    const result = await service.suggestForIncident("inc-1", USER, NOW);

    expect(result.reason).toBeNull();
    expect(result.candidates.map((c) => [c.userId, c.openIncidentCount])).toEqual([
      ["bob", 0],
      ["zed", 0],
      ["amy", 3],
    ]);
  });

  it("prefers working-shift engineers over on-call ones", async () => {
    const { service } = makeService({
      working: [rosterEntry("worker")],
      onCall: [rosterEntry("pager", { isOnCall: true })],
      skills: { worker: [STORAGE.id], pager: [STORAGE.id] },
      workload: { worker: 9 },
    });
    const result = await service.suggestForIncident("inc-1", USER, NOW);
    expect(result.candidates.map((c) => c.userId)).toEqual(["worker"]);
  });

  it("falls back to on-call engineers when no working engineer qualifies", async () => {
    const { service } = makeService({
      working: [rosterEntry("worker")],
      onCall: [rosterEntry("pager", { isOnCall: true })],
      skills: { pager: [STORAGE.id] },
    });
    const result = await service.suggestForIncident("inc-1", USER, NOW);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ userId: "pager", isOnCall: true });
  });

  it("dedupes an engineer with overlapping shifts and flags the current owner", async () => {
    const { service } = makeService({
      incident: incident({ ownerUserId: "eng-a" }),
      working: [rosterEntry("eng-a", { label: "Day" })],
      onCall: [rosterEntry("eng-a", { label: "Pager", isOnCall: true })],
      skills: { "eng-a": [STORAGE.id] },
    });
    const result = await service.suggestForIncident("inc-1", USER, NOW);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      shiftLabel: "Day",
      isOnCall: false,
      isCurrentOwner: true,
    });
  });
});

const CREATED = { incidentId: "inc-1", siteId: "site-1", correlationId: "corr-1" };

describe("RoutingService.onIncidentCreated (auto-assign)", () => {
  it("does nothing when the site has no policy (auto-assign off by default)", async () => {
    const { service, incidentsService } = makeService({ policy: null });
    await service.onIncidentCreated(CREATED, NOW);
    expect(incidentsService.findOne).not.toHaveBeenCalled();
    expect(incidentsService.autoAssign).not.toHaveBeenCalled();
  });

  it("does nothing when the site's policy is switched off", async () => {
    const { service, incidentsService } = makeService({
      policy: { id: "policy-1", autoAssignEnabled: false },
    });
    await service.onIncidentCreated(CREATED, NOW);
    expect(incidentsService.autoAssign).not.toHaveBeenCalled();
  });

  it("assigns the top-ranked candidate when enabled", async () => {
    const { service, incidentsService } = makeService({
      policy: { id: "policy-1", autoAssignEnabled: true },
      working: [rosterEntry("busy"), rosterEntry("free")],
      skills: { busy: [STORAGE.id], free: [STORAGE.id] },
      workload: { busy: 2 },
    });
    await service.onIncidentCreated(CREATED, NOW);
    expect(incidentsService.autoAssign).toHaveBeenCalledWith("inc-1", "free", "corr-1");
  });

  it("leaves the incident alone when nobody qualifies", async () => {
    const { service, incidentsService } = makeService({
      policy: { id: "policy-1", autoAssignEnabled: true },
      working: [rosterEntry("eng-a")],
      skills: {},
    });
    await service.onIncidentCreated(CREATED, NOW);
    expect(incidentsService.autoAssign).not.toHaveBeenCalled();
  });

  it("swallows failures so incident creation is never affected", async () => {
    const { service } = makeService({
      policy: { id: "policy-1", autoAssignEnabled: true },
      working: [rosterEntry("eng-a")],
      skills: { "eng-a": [STORAGE.id] },
      autoAssign: jest.fn().mockRejectedValue(new Error("db down")),
    });
    await expect(service.onIncidentCreated(CREATED, NOW)).resolves.toBeUndefined();
  });
});

describe("RoutingService policy", () => {
  it("reads an unconfigured site as auto-assign off", async () => {
    const { service } = makeService({ policy: null });
    await expect(service.getPolicy("site-1", USER)).resolves.toEqual({
      siteId: "site-1",
      autoAssignEnabled: false,
    });
  });

  it("rejects callers without access to the site", async () => {
    const { service } = makeService({ canAccessSite: false });
    await expect(service.getPolicy("site-1", USER)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.setPolicy("site-1", { autoAssignEnabled: true }, USER, { actorId: "desk-1" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("404s for an unknown site", async () => {
    const { service, prisma } = makeService({});
    (prisma.site.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      service.setPolicy("nope", { autoAssignEnabled: true }, USER, { actorId: "desk-1" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("upserts and audits a first-time enable as CREATE", async () => {
    const { service, tx, auditService } = makeService({ policy: null });
    const result = await service.setPolicy("site-1", { autoAssignEnabled: true }, USER, {
      actorId: "admin-1",
      correlationId: "corr-1",
    });

    expect(result).toEqual({ siteId: "site-1", autoAssignEnabled: true });
    expect(tx.routingPolicy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { siteId: "site-1" } }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "RoutingPolicy",
        action: "CREATE",
        actorId: "admin-1",
      }),
      tx,
    );
  });

  it("audits a change to an existing policy as UPDATE", async () => {
    const { service, auditService, tx } = makeService({
      policy: { id: "policy-1", autoAssignEnabled: true },
    });
    await service.setPolicy("site-1", { autoAssignEnabled: false }, USER, { actorId: "admin-1" });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "UPDATE" }),
      tx,
    );
  });
});
