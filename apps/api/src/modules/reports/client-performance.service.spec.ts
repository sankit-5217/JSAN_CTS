import { IncidentStatus, UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { ClientPerformanceService } from "./client-performance.service";

const CUSTOMER = {
  id: "cust-1",
  email: "client@example.com",
  role: UserRole.CLIENT_MANAGER_VIEWER,
  isActive: true,
} as AuthenticatedUser;

const NOW = new Date("2026-11-20T10:00:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function sla(overrides: Record<string, unknown> = {}) {
  return {
    ackDueAt: at(-90),
    ackedAt: at(-100),
    resolveDueAt: at(120),
    resolvedAt: null,
    pausedAt: null,
    firedMilestones: [],
    ...overrides,
  };
}

function incident(overrides: Record<string, unknown> = {}) {
  return {
    id: "inc-1",
    status: IncidentStatus.IN_PROGRESS,
    createdAt: at(-60),
    acknowledgedAt: null,
    restoredAt: null,
    slaInstances: [sla()],
    ...overrides,
  };
}

function makeService(tickets: ReturnType<typeof incident>[]) {
  const prisma = {
    incident: { findMany: jest.fn().mockResolvedValue(tickets) },
  };
  return {
    service: new ClientPerformanceService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe("ClientPerformanceService.getReport", () => {
  it("only reads the caller's own tickets, within their sites", async () => {
    const { service, prisma } = makeService([]);

    await service.getReport(CUSTOMER, ["site-a"], NOW);

    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          siteId: { in: ["site-a"] },
          reportedByUserId: "cust-1",
        }),
      }),
    );
  });

  it("counts open, resolved and closed tickets", async () => {
    const { service } = makeService([
      incident({ id: "a", status: IncidentStatus.IN_PROGRESS }),
      incident({ id: "b", status: IncidentStatus.RESOLVED }),
      incident({ id: "c", status: IncidentStatus.CLOSED }),
    ]);

    const report = await service.getReport(CUSTOMER, ["site-a"], NOW);

    // RESOLVED has left the open queue — it's awaiting the customer's
    // confirmation, and counts as resolved.
    expect(report.totals).toEqual({ reported: 3, open: 1, resolved: 2, closed: 1 });
  });

  it("counts a cancelled ticket as neither open nor resolved", async () => {
    const { service } = makeService([incident({ id: "a", status: IncidentStatus.CANCELLED })]);

    const report = await service.getReport(CUSTOMER, ["site-a"], NOW);

    expect(report.totals).toEqual({ reported: 1, open: 0, resolved: 0, closed: 0 });
  });

  it("calls a met target met and a late one breached", async () => {
    const { service } = makeService([
      // Resolved inside the target: the resolution clock completed before
      // its due time.
      incident({
        id: "a",
        status: IncidentStatus.CLOSED,
        slaInstances: [sla({ resolvedAt: at(-30) })],
      }),
      // Resolved after the due time.
      incident({
        id: "b",
        status: IncidentStatus.CLOSED,
        slaInstances: [sla({ resolveDueAt: at(-60), resolvedAt: at(-30) })],
      }),
    ]);

    const report = await service.getReport(CUSTOMER, ["site-a"], NOW);

    expect(report.sla.met).toBe(1);
    expect(report.sla.breached).toBe(1);
  });

  it("reports a live ticket as on track rather than met", async () => {
    const { service } = makeService([incident({ status: IncidentStatus.IN_PROGRESS })]);

    const report = await service.getReport(CUSTOMER, ["site-a"], NOW);

    expect(report.sla.onTrack).toBe(1);
    expect(report.sla.met).toBe(0);
    expect(report.sla.breached).toBe(0);
  });

  it("averages the acknowledge and resolve times over resolved tickets", async () => {
    const { service } = makeService([
      incident({
        id: "a",
        status: IncidentStatus.CLOSED,
        createdAt: at(-120),
        acknowledgedAt: at(-100),
        restoredAt: at(-60),
      }),
      incident({
        id: "b",
        status: IncidentStatus.CLOSED,
        createdAt: at(-120),
        acknowledgedAt: at(-60),
        restoredAt: at(-60),
      }),
    ]);

    const report = await service.getReport(CUSTOMER, ["site-a"], NOW);

    // 20 and 60 minutes to acknowledge; 60 and 60 to resolve.
    expect(report.averages.ackMinutes).toBe(40);
    expect(report.averages.resolveMinutes).toBe(60);
  });

  it("has no averages when nothing has been resolved yet", async () => {
    const { service } = makeService([incident({ status: IncidentStatus.IN_PROGRESS })]);

    const report = await service.getReport(CUSTOMER, ["site-a"], NOW);

    expect(report.averages.ackMinutes).toBeNull();
    expect(report.averages.resolveMinutes).toBeNull();
  });

  it("buckets tickets into months, oldest first, with empty months filled in", async () => {
    const { service } = makeService([
      incident({ id: "a", createdAt: new Date("2026-11-02T10:00:00Z") }),
      incident({ id: "b", createdAt: new Date("2026-11-02T10:00:00Z") }),
      incident({
        id: "c",
        createdAt: new Date("2026-10-15T10:00:00Z"),
        status: IncidentStatus.CLOSED,
      }),
    ]);

    const report = await service.getReport(CUSTOMER, ["site-a"], NOW);

    expect(report.monthly).toHaveLength(12);
    expect(report.monthly[report.monthly.length - 1]).toEqual({
      month: "2026-11",
      reported: 2,
      resolved: 0,
    });
    expect(report.monthly[report.monthly.length - 2]).toEqual({
      month: "2026-10",
      reported: 1,
      resolved: 1,
    });
    // A month with no tickets still appears, so the trend has no gaps.
    expect(report.monthly[0]).toEqual({ month: "2025-12", reported: 0, resolved: 0 });
  });
});
