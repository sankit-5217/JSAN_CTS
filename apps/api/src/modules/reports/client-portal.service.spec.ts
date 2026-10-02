import { IncidentStatus, Priority, UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { ShiftsService } from "../shifts/shifts.service";
import { ClientPortalService } from "./client-portal.service";

const CUSTOMER = {
  id: "cust-1",
  email: "client@example.com",
  role: UserRole.CLIENT_MANAGER_VIEWER,
  isActive: true,
} as AuthenticatedUser;

const NOW = new Date("2026-09-30T10:00:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: "inc-1",
    incidentNo: "INC-000042",
    shortDescription: "Rack PDU alarm",
    siteId: "site-a",
    status: IncidentStatus.IN_PROGRESS,
    ownerUserId: "eng-1",
    owner: { displayName: "Rahul" },
    slaInstances: [
      {
        ackDueAt: at(-90),
        ackedAt: at(-100),
        resolveDueAt: at(120),
        resolvedAt: null,
        pausedAt: null,
        firedMilestones: [],
      },
    ],
    worklogs: [],
    ...overrides,
  };
}

function rosterEntry(overrides: Record<string, unknown> = {}) {
  return {
    shiftId: "shift-1",
    label: "Day shift",
    isOnCall: false,
    siteId: "site-a",
    siteCode: "SITE01",
    userId: "eng-1",
    displayName: "Rahul",
    email: "rahul@jsan.example",
    ...overrides,
  };
}

function makeService(
  opts: {
    contacts?: unknown[];
    openBySite?: { siteId: string; priority: Priority; _count: { _all: number } }[];
    tickets?: ReturnType<typeof ticket>[];
    working?: ReturnType<typeof rosterEntry>[];
    onCall?: ReturnType<typeof rosterEntry>[];
  } = {},
) {
  const prisma = {
    site: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "site-a",
          code: "SITE01",
          name: "Demo Data Center 1",
          contacts: opts.contacts ?? [],
        },
      ]),
    },
    incident: {
      groupBy: jest.fn().mockResolvedValue(opts.openBySite ?? []),
      findMany: jest.fn().mockResolvedValue(opts.tickets ?? []),
    },
  };
  const shifts = {
    getLiveRoster: jest.fn().mockResolvedValue({
      asOf: NOW.toISOString(),
      working: opts.working ?? [],
      onCall: opts.onCall ?? [],
    }),
  };
  const service = new ClientPortalService(
    prisma as unknown as PrismaService,
    shifts as unknown as ShiftsService,
  );
  return { service, prisma, shifts };
}

describe("ClientPortalService.getOverview", () => {
  it("only reads the caller's own tickets, within their sites", async () => {
    const { service, prisma, shifts } = makeService();

    await service.getOverview(CUSTOMER, ["site-a"], NOW);

    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { siteId: { in: ["site-a"] }, reportedByUserId: "cust-1" },
      }),
    );
    expect(prisma.site.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["site-a"] } } }),
    );
    expect(shifts.getLiveRoster).toHaveBeenCalledWith({}, ["site-a"], NOW);
  });

  it("lists reachable contacts, on-call first, and drops ones with no phone or email", async () => {
    const { service } = makeService({
      contacts: [
        {
          name: "Asha",
          role: "Service Desk",
          phone: "+91 11 5550 0100",
          email: null,
          isOnCall: false,
        },
        {
          name: "Dev",
          role: "Duty Manager",
          phone: null,
          email: "duty@jsan.example",
          isOnCall: true,
        },
        { name: "Nobody", role: "Placeholder", phone: null, email: null, isOnCall: false },
      ],
    });

    const { sites } = await service.getOverview(CUSTOMER, ["site-a"], NOW);

    expect(sites[0].contacts.map((c) => c.name)).toEqual(["Dev", "Asha"]);
  });

  it("derives the site state from open incident counts at the site", async () => {
    const none = await makeService().service.getOverview(CUSTOMER, ["site-a"], NOW);
    const minor = await makeService({
      openBySite: [{ siteId: "site-a", priority: Priority.P3, _count: { _all: 2 } }],
    }).service.getOverview(CUSTOMER, ["site-a"], NOW);
    const major = await makeService({
      openBySite: [
        { siteId: "site-a", priority: Priority.P3, _count: { _all: 2 } },
        { siteId: "site-a", priority: Priority.P1, _count: { _all: 1 } },
      ],
    }).service.getOverview(CUSTOMER, ["site-a"], NOW);

    expect(none.sites[0]).toMatchObject({ state: "NO_OPEN_ISSUES", openIssues: 0 });
    expect(minor.sites[0]).toMatchObject({ state: "ISSUE_IN_PROGRESS", openIssues: 2 });
    expect(major.sites[0]).toMatchObject({ state: "MAJOR_INCIDENT", openIssues: 3 });
  });

  it("shows the on-duty team by name with the caller's tickets, never an email or user id", async () => {
    const { service } = makeService({
      tickets: [ticket(), ticket({ id: "inc-2", incidentNo: "INC-000043", status: "CLOSED" })],
      working: [rosterEntry()],
      onCall: [
        rosterEntry({ userId: "eng-2", displayName: "Meera", isOnCall: true, label: "On call" }),
      ],
    });

    const { sites } = await service.getOverview(CUSTOMER, ["site-a"], NOW);

    expect(sites[0].team).toEqual([
      { name: "Meera", duty: "ON_CALL", shiftLabel: "On call", tickets: [] },
      {
        name: "Rahul",
        duty: "ON_SHIFT",
        shiftLabel: "Day shift",
        tickets: [{ id: "inc-1", incidentNo: "INC-000042", shortDescription: "Rack PDU alarm" }],
      },
    ]);
    expect(JSON.stringify(sites)).not.toContain("rahul@jsan.example");
  });

  it("prefers the working shift when someone is also on call", async () => {
    const { service } = makeService({
      working: [rosterEntry()],
      onCall: [rosterEntry({ isOnCall: true, label: "On call" })],
    });

    const { sites } = await service.getOverview(CUSTOMER, ["site-a"], NOW);

    expect(sites[0].team).toHaveLength(1);
    expect(sites[0].team[0].duty).toBe("ON_SHIFT");
  });

  it("gives each ticket its SLA status and live activity", async () => {
    const { service } = makeService({
      tickets: [
        ticket({ worklogs: [{ startedAt: at(-15), engineer: { displayName: "Rahul" } }] }),
        ticket({ id: "inc-2", ownerUserId: "eng-9", owner: { displayName: "Sam" } }),
        ticket({ id: "inc-3", ownerUserId: null, owner: null, slaInstances: [] }),
      ],
      working: [rosterEntry()],
    });

    const { tickets } = await service.getOverview(CUSTOMER, ["site-a"], NOW);

    expect(tickets[0]).toMatchObject({
      id: "inc-1",
      sla: { overall: "ON_TRACK", response: { state: "MET" } },
      activity: {
        engineer: "Rahul",
        duty: "ON_SHIFT",
        workingNow: { engineer: "Rahul", since: at(-15) },
      },
    });
    expect(tickets[1].activity).toEqual({ engineer: "Sam", duty: "OFF_DUTY", workingNow: null });
    expect(tickets[2]).toMatchObject({
      sla: null,
      activity: { engineer: null, duty: null, workingNow: null },
    });
  });

  it("doesn't call a finished ticket 'being worked on' because of a dangling work session", async () => {
    const { service } = makeService({
      tickets: [
        ticket({
          status: IncidentStatus.CLOSED,
          worklogs: [{ startedAt: at(-600), engineer: { displayName: "Rahul" } }],
        }),
      ],
    });

    const { tickets } = await service.getOverview(CUSTOMER, ["site-a"], NOW);

    expect(tickets[0].activity.workingNow).toBeNull();
  });
});
