import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthzService } from "../auth/authz.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { IncidentsService } from "../incidents/incidents.service";
import { RosterEntry, ShiftsService } from "../shifts/shifts.service";
import { SkillsService } from "../skills/skills.service";
import { DEFAULT_ROUTING_SETTINGS, RoutingService } from "./routing.service";

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
  workload?: Record<string, Partial<Record<"P1" | "P2" | "P3" | "P4", number>>>;
  settings?: Partial<typeof DEFAULT_ROUTING_SETTINGS>;
  policy?: { id: string; autoAssignEnabled: boolean } | null;
  canAccessSite?: boolean;
}) {
  const tx = {
    routingPolicy: {
      upsert: jest
        .fn()
        .mockImplementation(({ create }) =>
          Promise.resolve({ id: "policy-1", ...DEFAULT_ROUTING_SETTINGS, ...create }),
        ),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    routingPolicy: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.policy
            ? { ...DEFAULT_ROUTING_SETTINGS, ...opts.settings, ...opts.policy }
            : opts.settings
              ? {
                  id: "policy-1",
                  autoAssignEnabled: false,
                  ...DEFAULT_ROUTING_SETTINGS,
                  ...opts.settings,
                }
              : null,
        ),
    },
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
    findOneScoped: opts.findOneScoped ?? jest.fn().mockResolvedValue(opts.incident ?? incident()),
    countOpenOwnedByPriority: jest
      .fn()
      .mockResolvedValue(new Map(Object.entries(opts.workload ?? {}))),
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
      workload: { amy: { P3: 3 } },
    });
    const result = await service.suggestForIncident("inc-1", USER, NOW);

    expect(result.reason).toBeNull();
    expect(result.candidates.map((c) => [c.userId, c.openIncidentCount, c.workloadScore])).toEqual([
      ["bob", 0, 0],
      ["zed", 0, 0],
      ["amy", 3, 6],
    ]);
  });

  it("weights workload by priority: one P1 outweighs two P4s", async () => {
    const { service } = makeService({
      working: [rosterEntry("holds-p1"), rosterEntry("holds-p4s")],
      skills: { "holds-p1": [STORAGE.id], "holds-p4s": [STORAGE.id] },
      workload: { "holds-p1": { P1: 1 }, "holds-p4s": { P4: 2 } },
    });
    const result = await service.suggestForIncident("inc-1", USER, NOW);
    expect(result.candidates.map((c) => [c.userId, c.workloadScore])).toEqual([
      ["holds-p4s", 2],
      ["holds-p1", 4],
    ]);
  });

  it("uses the site's own workload weights", async () => {
    const { service } = makeService({
      settings: { workloadWeightP1: 1, workloadWeightP4: 5 },
      working: [rosterEntry("holds-p1"), rosterEntry("holds-p4s")],
      skills: { "holds-p1": [STORAGE.id], "holds-p4s": [STORAGE.id] },
      workload: { "holds-p1": { P1: 1 }, "holds-p4s": { P4: 2 } },
    });
    const result = await service.suggestForIncident("inc-1", USER, NOW);
    expect(result.candidates.map((c) => [c.userId, c.workloadScore])).toEqual([
      ["holds-p1", 1],
      ["holds-p4s", 10],
    ]);
  });

  it("includes on-call engineers from the start for a P1, after the working shift", async () => {
    const { service } = makeService({
      incident: incident({ priority: "P1" }),
      working: [rosterEntry("worker")],
      onCall: [rosterEntry("pager", { isOnCall: true })],
      skills: { worker: [STORAGE.id], pager: [STORAGE.id] },
      workload: { worker: { P2: 3 } },
    });
    const result = await service.suggestForIncident("inc-1", USER, NOW);
    expect(result.candidates.map((c) => [c.userId, c.isOnCall])).toEqual([
      ["worker", false],
      ["pager", true],
    ]);
  });

  it("prefers working-shift engineers over on-call ones", async () => {
    const { service } = makeService({
      working: [rosterEntry("worker")],
      onCall: [rosterEntry("pager", { isOnCall: true })],
      skills: { worker: [STORAGE.id], pager: [STORAGE.id] },
      workload: { worker: { P3: 9 } },
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

describe("RoutingService policy", () => {
  it("reads an unconfigured site as auto-routing off with the default per-priority settings", async () => {
    const { service } = makeService({ policy: null });
    await expect(service.getPolicy("site-1", USER)).resolves.toEqual({
      siteId: "site-1",
      autoAssignEnabled: false,
      offerTimeoutP1Minutes: 2,
      offerTimeoutP2Minutes: 5,
      offerTimeoutP3Minutes: 10,
      offerTimeoutP4Minutes: 15,
      workloadWeightP1: 4,
      workloadWeightP2: 3,
      workloadWeightP3: 2,
      workloadWeightP4: 1,
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
    const result = await service.setPolicy(
      "site-1",
      { autoAssignEnabled: true, offerTimeoutP1Minutes: 1, workloadWeightP1: 6 },
      USER,
      { actorId: "admin-1", correlationId: "corr-1" },
    );

    expect(result).toEqual({
      siteId: "site-1",
      autoAssignEnabled: true,
      ...DEFAULT_ROUTING_SETTINGS,
      offerTimeoutP1Minutes: 1,
      workloadWeightP1: 6,
    });
    expect(tx.routingPolicy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { siteId: "site-1" },
        update: { autoAssignEnabled: true, offerTimeoutP1Minutes: 1, workloadWeightP1: 6 },
      }),
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
