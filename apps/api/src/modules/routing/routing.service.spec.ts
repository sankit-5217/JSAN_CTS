import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
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
}) {
  const incidentsService = {
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
    service: new RoutingService(incidentsService, shiftsService, skillsService),
    incidentsService,
    shiftsService,
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
