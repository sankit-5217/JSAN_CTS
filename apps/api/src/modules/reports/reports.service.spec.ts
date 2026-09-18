import { CiType, IncidentStatus, Priority } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ReportsService } from "./reports.service";

interface CiFixture {
  siteId: string;
  ciType: CiType;
  healthSnapshot: { overallHealth: string } | null;
}

interface IncidentFixture {
  siteId: string;
  status: IncidentStatus;
  priority: Priority;
  createdAt: Date;
  slaInstances: { breached: boolean; firedMilestones: string[] }[];
}

function makeService(
  overrides: {
    sites?: { id: string; code: string; name: string }[];
    cis?: CiFixture[];
    incidents?: IncidentFixture[];
    criticalAlertsOpen?: number;
  } = {},
) {
  const sites = overrides.sites ?? [{ id: "site-a", code: "SITE01", name: "Demo Data Center 1" }];
  const cis = overrides.cis ?? [];
  const incidents = overrides.incidents ?? [];

  const prisma = {
    site: { findMany: jest.fn().mockResolvedValue(sites) },
    configurationItem: { findMany: jest.fn().mockResolvedValue(cis) },
    incident: { findMany: jest.fn().mockResolvedValue(incidents) },
    alert: { count: jest.fn().mockResolvedValue(overrides.criticalAlertsOpen ?? 0) },
  } as unknown as PrismaService;

  return { service: new ReportsService(prisma), prisma };
}

function ci(overrides: Partial<CiFixture> = {}): CiFixture {
  return {
    siteId: "site-a",
    ciType: CiType.SERVER,
    healthSnapshot: { overallHealth: "HEALTHY" },
    ...overrides,
  };
}

function incident(overrides: Partial<IncidentFixture> = {}): IncidentFixture {
  return {
    siteId: "site-a",
    status: IncidentStatus.NEW,
    priority: Priority.P3,
    createdAt: new Date(),
    slaInstances: [],
    ...overrides,
  };
}

describe("ReportsService.getCommandCenterSummary — health rollup", () => {
  it("rolls a site up to its worst CI health", async () => {
    const { service } = makeService({
      cis: [
        ci({ healthSnapshot: { overallHealth: "HEALTHY" } }),
        ci({ healthSnapshot: { overallHealth: "CRITICAL" } }),
      ],
    });
    const result = await service.getCommandCenterSummary(null);
    expect(result.siteCards[0].health).toBe("CRITICAL");
    expect(result.counters.sitesCritical).toBe(1);
    expect(result.counters.sitesHealthy).toBe(0);
  });

  it("treats a CI with no snapshot as UNKNOWN, not HEALTHY", async () => {
    const { service } = makeService({ cis: [ci({ healthSnapshot: null })] });
    const result = await service.getCommandCenterSummary(null);
    expect(result.siteCards[0].health).toBe("UNKNOWN");
    // UNKNOWN counts toward none of the three headline buckets.
    expect(
      result.counters.sitesHealthy + result.counters.sitesWarning + result.counters.sitesCritical,
    ).toBe(0);
  });

  it("a site with no CIs at all is UNKNOWN, not silently HEALTHY", async () => {
    const { service } = makeService({ cis: [] });
    const result = await service.getCommandCenterSummary(null);
    expect(result.siteCards[0].health).toBe("UNKNOWN");
  });

  it("a site where every CI is HEALTHY rolls up to HEALTHY, not UNKNOWN", async () => {
    // Regression case: a naive worst-of fold seeded at UNKNOWN never
    // advances past it when every real reading is HEALTHY (a *lower*
    // rank) — caught via manual end-to-end verification, not this suite,
    // the first time around.
    const { service } = makeService({
      cis: [
        ci({ healthSnapshot: { overallHealth: "HEALTHY" } }),
        ci({ healthSnapshot: { overallHealth: "HEALTHY" } }),
      ],
    });
    const result = await service.getCommandCenterSummary(null);
    expect(result.siteCards[0].health).toBe("HEALTHY");
    expect(result.counters.sitesHealthy).toBe(1);
  });
});

describe("ReportsService.getCommandCenterSummary — server availability", () => {
  it("only counts CiType.SERVER, excluding CRITICAL and no-data CIs as reachable", async () => {
    const { service } = makeService({
      cis: [
        ci({ ciType: CiType.SERVER, healthSnapshot: { overallHealth: "HEALTHY" } }),
        ci({ ciType: CiType.SERVER, healthSnapshot: { overallHealth: "CRITICAL" } }),
        ci({ ciType: CiType.SERVER, healthSnapshot: null }),
        ci({ ciType: CiType.SWITCH, healthSnapshot: { overallHealth: "HEALTHY" } }), // not a server
      ],
    });
    const result = await service.getCommandCenterSummary(null);
    expect(result.counters.serversTotal).toBe(3);
    expect(result.counters.serversReachable).toBe(1);
  });
});

describe("ReportsService.getCommandCenterSummary — incident counters and queues", () => {
  it("counts P1/P2 open incidents but not P3/P4 or closed ones", async () => {
    const { service } = makeService({
      incidents: [
        incident({ priority: Priority.P1, status: IncidentStatus.NEW }),
        incident({ priority: Priority.P2, status: IncidentStatus.IN_PROGRESS }),
        incident({ priority: Priority.P1, status: IncidentStatus.CLOSED }), // closed — excluded
        incident({ priority: Priority.P3, status: IncidentStatus.NEW }), // wrong priority
      ],
    });
    const result = await service.getCommandCenterSummary(null);
    expect(result.counters.p1p2OpenIncidents).toBe(2);
  });

  it("counts an SLA-at-risk incident (warning fired, not breached) but not a breached or clean one", async () => {
    const { service } = makeService({
      incidents: [
        incident({ slaInstances: [{ breached: false, firedMilestones: ["ACK_75"] }] }), // at risk
        incident({ slaInstances: [{ breached: true, firedMilestones: ["ACK_75", "ACK_BREACH"] }] }), // breached, not "at risk"
        incident({ slaInstances: [{ breached: false, firedMilestones: [] }] }), // clean
      ],
    });
    const result = await service.getCommandCenterSummary(null);
    expect(result.counters.slaAtRiskIncidents).toBe(1);
    expect(result.queues.slaBreachRisk).toBe(1);
  });

  it("maps each queue to its status", async () => {
    const { service } = makeService({
      incidents: [
        incident({ status: IncidentStatus.NEW }),
        incident({ status: IncidentStatus.ASSIGNED }),
        incident({ status: IncidentStatus.PENDING_VENDOR }),
        incident({ status: IncidentStatus.REOPENED }),
      ],
    });
    const result = await service.getCommandCenterSummary(null);
    expect(result.queues.unassigned).toBe(1);
    expect(result.queues.awaitingAck).toBe(1);
    expect(result.queues.vendorWaiting).toBe(1);
    expect(result.queues.reopened).toBe(1);
  });

  it("computes the oldest open incident's age for a site card", async () => {
    const oldCreatedAt = new Date(Date.now() - 3 * 60 * 60_000); // 3h ago
    const { service } = makeService({
      incidents: [
        incident({ createdAt: new Date(), status: IncidentStatus.NEW }),
        incident({ createdAt: oldCreatedAt, status: IncidentStatus.NEW }),
      ],
    });
    const result = await service.getCommandCenterSummary(null);
    expect(result.siteCards[0].openIncidents).toBe(2);
    expect(result.siteCards[0].oldestOpenIncidentAgeMinutes).toBeGreaterThanOrEqual(179);
  });
});

describe("ReportsService.getCommandCenterSummary — per-site incident counters", () => {
  it("scopes P1/P2 and SLA-at-risk counts to each site, not the global total", async () => {
    const { service } = makeService({
      sites: [
        { id: "site-a", code: "SITE01", name: "Demo 1" },
        { id: "site-b", code: "SITE02", name: "Demo 2" },
      ],
      incidents: [
        incident({ siteId: "site-a", priority: Priority.P1, status: IncidentStatus.NEW }),
        incident({
          siteId: "site-a",
          slaInstances: [{ breached: false, firedMilestones: ["ACK_75"] }],
        }),
        incident({ siteId: "site-b", priority: Priority.P3, status: IncidentStatus.NEW }),
      ],
    });
    const result = await service.getCommandCenterSummary(null);
    const siteA = result.siteCards.find((s) => s.code === "SITE01")!;
    const siteB = result.siteCards.find((s) => s.code === "SITE02")!;
    expect(siteA.p1p2OpenIncidents).toBe(1);
    expect(siteA.slaAtRiskIncidents).toBe(1);
    expect(siteB.p1p2OpenIncidents).toBe(0);
    expect(siteB.slaAtRiskIncidents).toBe(0);
  });
});

describe("ReportsService.generateOperationalHealthCsv", () => {
  it("includes a summary section and a per-site breakdown row", async () => {
    const { service } = makeService({
      sites: [{ id: "site-a", code: "SITE01", name: "Demo Data Center 1" }],
      cis: [ci({ healthSnapshot: { overallHealth: "HEALTHY" } })],
      incidents: [incident({ priority: Priority.P1, status: IncidentStatus.NEW })],
      criticalAlertsOpen: 2,
    });
    const csv = await service.generateOperationalHealthCsv(null);

    expect(csv).toContain("Operational Health Report");
    expect(csv).toContain("Sites Healthy,1");
    expect(csv).toContain("Critical Alerts Open,2");
    expect(csv).toContain("Site Breakdown");
    expect(csv).toContain("SITE01,Demo Data Center 1,HEALTHY");
  });

  it("quotes a site name that contains a comma", async () => {
    const { service } = makeService({
      sites: [{ id: "site-a", code: "SITE01", name: "Demo, Data Center 1" }],
    });
    const csv = await service.generateOperationalHealthCsv(null);
    expect(csv).toContain('"Demo, Data Center 1"');
  });
});

describe("ReportsService.getResponseTrend", () => {
  // Anchored to "yesterday, mid-morning" relative to the real clock at test
  // time, so the fixture always lands inside the window regardless of when
  // the suite runs, without mocking Date.
  const yesterday = new Date(Date.now() - 24 * 60 * 60_000);
  yesterday.setUTCHours(10, 0, 0, 0);
  const dayKey = yesterday.toISOString().slice(0, 10);

  function trendIncident(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      siteId: "site-a",
      priority: Priority.P2,
      createdAt: yesterday,
      acknowledgedAt: null,
      restoredAt: null,
      ...overrides,
    };
  }

  it("computes overall and per-day MTTA/MTTR averages in minutes", async () => {
    const { service } = makeService({
      incidents: [
        trendIncident({
          acknowledgedAt: new Date(yesterday.getTime() + 10 * 60_000), // 10 min ack
          restoredAt: new Date(yesterday.getTime() + 60 * 60_000), // 60 min restore
        }),
        trendIncident({
          acknowledgedAt: new Date(yesterday.getTime() + 30 * 60_000), // 30 min ack
          restoredAt: null, // not yet restored — excluded from restore average
        }),
      ] as never,
    });

    const result = await service.getResponseTrend(null, 7);

    expect(result.overall.incidentCount).toBe(2);
    expect(result.overall.avgAckMinutes).toBe(20); // (10 + 30) / 2
    expect(result.overall.avgRestoreMinutes).toBe(60); // only the one restored incident

    const day = result.daily.find((d) => d.date === dayKey);
    expect(day?.incidentsCreated).toBe(2);
    expect(day?.avgAckMinutes).toBe(20);
    expect(day?.avgRestoreMinutes).toBe(60);
  });

  it("fills every day in the window, including days with zero incidents", async () => {
    const { service } = makeService({ incidents: [] });
    const result = await service.getResponseTrend(null, 7);
    expect(result.daily).toHaveLength(8); // inclusive of both endpoints
    expect(result.daily.every((d) => d.incidentsCreated === 0)).toBe(true);
    expect(result.daily.every((d) => d.avgAckMinutes === null)).toBe(true);
  });

  it("breaks the window down by priority", async () => {
    const { service } = makeService({
      incidents: [
        trendIncident({
          priority: Priority.P1,
          acknowledgedAt: new Date(yesterday.getTime() + 5 * 60_000),
        }),
        trendIncident({
          priority: Priority.P4,
          acknowledgedAt: new Date(yesterday.getTime() + 20 * 60_000),
        }),
      ] as never,
    });
    const result = await service.getResponseTrend(null, 7);
    const p1 = result.byPriority.find((p) => p.priority === Priority.P1);
    const p4 = result.byPriority.find((p) => p.priority === Priority.P4);
    expect(p1?.incidentCount).toBe(1);
    expect(p1?.avgAckMinutes).toBe(5);
    expect(p4?.incidentCount).toBe(1);
    expect(p4?.avgAckMinutes).toBe(20);
  });

  it("passes the site filter and date window through to the query", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      incident: { findMany },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma);

    await service.getResponseTrend(["site-9"], 30);
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.siteId).toEqual({ in: ["site-9"] });
    expect(arg.where.createdAt.gte).toBeInstanceOf(Date);
    expect(arg.where.createdAt.lte).toBeInstanceOf(Date);
  });
});

describe("ReportsService.getCommandCenterSummary — site scoping", () => {
  it("passes accessibleSiteIds through to the site query", async () => {
    const { service, prisma } = makeService({
      sites: [{ id: "site-a", code: "SITE01", name: "Demo 1" }],
    });
    await service.getCommandCenterSummary(["site-a"]);
    expect(prisma.site.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["site-a"] } } }),
    );
  });

  it("applies no site filter for an unrestricted (null) caller", async () => {
    const { service, prisma } = makeService();
    await service.getCommandCenterSummary(null);
    expect(prisma.site.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });
});
