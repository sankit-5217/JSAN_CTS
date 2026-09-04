import { NotFoundException } from "@nestjs/common";
import { Priority } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SitesService } from "../sites/sites.service";
import { SlaService } from "./sla.service";

function basePolicy(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "policy-p1",
    name: "P1 Critical (24x7)",
    priority: Priority.P1,
    ackTargetMinutes: 15,
    resolveTargetMinutes: 240,
    usesBusinessCalendar: false,
    escalationThresholdsPercent: [50, 75, 90],
    pausesOnPendingVendor: true,
    pausesOnPendingCustomer: true,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    isActive: true,
    ...overrides,
  };
}

function baseInstance(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "instance-1",
    incidentId: "incident-1",
    slaPolicyId: "policy-p1",
    ackDueAt: new Date("2026-09-03T10:15:00Z"),
    ackedAt: null,
    resolveDueAt: new Date("2026-09-03T14:00:00Z"),
    resolvedAt: null,
    pausedAt: null,
    pausedMinutes: 0,
    firedMilestones: [],
    breached: false,
    ...overrides,
  };
}

function makeService(
  overrides: {
    slaPolicyFindFirst?: jest.Mock;
    siteFindUnique?: jest.Mock;
    listSupportCalendars?: jest.Mock;
    txSlaInstance?: Partial<Record<string, jest.Mock>>;
    txSlaPolicy?: Partial<Record<string, jest.Mock>>;
  } = {},
) {
  const txSlaInstance = {
    create: jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ ...baseInstance(), ...data })),
    update: jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ ...baseInstance(), ...data })),
    findFirst: jest.fn().mockResolvedValue(baseInstance()),
    ...overrides.txSlaInstance,
  };
  const txSlaPolicy = {
    findUnique: jest.fn().mockResolvedValue(basePolicy()),
    ...overrides.txSlaPolicy,
  };
  const tx = { slaInstance: txSlaInstance, slaPolicy: txSlaPolicy };

  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    slaPolicy: {
      findFirst: overrides.slaPolicyFindFirst ?? jest.fn().mockResolvedValue(basePolicy()),
      findMany: jest.fn().mockResolvedValue([basePolicy()]),
      findUnique: jest.fn().mockResolvedValue(basePolicy()),
    },
    slaInstance: {
      findFirst: jest.fn().mockResolvedValue(baseInstance()),
    },
    site: {
      findUnique: overrides.siteFindUnique ?? jest.fn().mockResolvedValue({ timezone: "UTC" }),
    },
  } as unknown as PrismaService;

  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const sitesService = {
    listSupportCalendars:
      overrides.listSupportCalendars ?? jest.fn().mockResolvedValue([]),
  } as unknown as SitesService;

  return {
    service: new SlaService(prisma, auditService, sitesService),
    prisma,
    auditService,
    sitesService,
    tx,
  };
}

describe("SlaService.resolvePolicy", () => {
  it("finds the active policy effective at the given instant", async () => {
    const { service, prisma } = makeService();
    const result = await service.resolvePolicy(Priority.P1, new Date("2026-09-03T10:00:00Z"));
    expect(result.id).toBe("policy-p1");
    expect(prisma.slaPolicy.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ priority: Priority.P1, isActive: true }) }),
    );
  });

  it("throws NotFoundException when no active policy covers that priority", async () => {
    const { service } = makeService({ slaPolicyFindFirst: jest.fn().mockResolvedValue(null) });
    await expect(service.resolvePolicy(Priority.P4, new Date())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("SlaService.resolveCalendar", () => {
  it("returns null when the site has no configured calendar (treated as 24x7)", async () => {
    const { service } = makeService({ listSupportCalendars: jest.fn().mockResolvedValue([]) });
    await expect(service.resolveCalendar("site-a")).resolves.toBeNull();
  });

  it("returns the site's first calendar when one exists", async () => {
    const calendar = { id: "cal-1", siteId: "site-a" };
    const { service } = makeService({
      listSupportCalendars: jest.fn().mockResolvedValue([calendar]),
    });
    await expect(service.resolveCalendar("site-a")).resolves.toBe(calendar);
  });
});

describe("SlaService.startForIncident", () => {
  it("resolves the policy, computes due dates, and creates the instance inside the given transaction", async () => {
    const { service, tx, auditService } = makeService();
    const result = await service.startForIncident(
      tx as never,
      { id: "incident-1", siteId: "site-a" },
      Priority.P1,
      { actorId: "user-1" },
    );

    expect(tx.slaInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ incidentId: "incident-1", slaPolicyId: "policy-p1" }),
      }),
    );
    expect(result.ackDueAt).toBeInstanceOf(Date);
    expect(result.resolveDueAt).toBeInstanceOf(Date);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "SlaInstance", action: "CREATE" }),
      tx,
    );
  });
});

describe("SlaService.onAcknowledged", () => {
  it("sets ackedAt when the instance hasn't already been acked", async () => {
    const { service, tx } = makeService();
    const ackedAt = new Date("2026-09-03T10:10:00Z");
    await service.onAcknowledged(tx as never, "incident-1", ackedAt, { actorId: "user-1" });
    expect(tx.slaInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ackedAt } }),
    );
  });

  it("no-ops when the instance was already acked", async () => {
    const { service, tx } = makeService({
      txSlaInstance: { findFirst: jest.fn().mockResolvedValue(baseInstance({ ackedAt: new Date() })) },
    });
    await service.onAcknowledged(tx as never, "incident-1", new Date(), { actorId: "user-1" });
    expect(tx.slaInstance.update).not.toHaveBeenCalled();
  });
});

describe("SlaService.onResolved", () => {
  it("sets resolvedAt and clears any pause window", async () => {
    const { service, tx } = makeService();
    const resolvedAt = new Date("2026-09-03T13:00:00Z");
    await service.onResolved(tx as never, "incident-1", resolvedAt, { actorId: "user-1" });
    expect(tx.slaInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { resolvedAt, pausedAt: null } }),
    );
  });
});

describe("SlaService.onPaused / onResumed", () => {
  it("pauses when the policy allows it for PENDING_VENDOR", async () => {
    const { service, tx } = makeService();
    await service.onPaused(tx as never, "incident-1", "PENDING_VENDOR", { actorId: "user-1" });
    expect(tx.slaInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pausedAt: expect.any(Date) }) }),
    );
  });

  it("does not pause when the policy has pausesOnPendingVendor: false", async () => {
    const { service, tx } = makeService({
      txSlaPolicy: {
        findUnique: jest.fn().mockResolvedValue(basePolicy({ pausesOnPendingVendor: false })),
      },
    });
    await service.onPaused(tx as never, "incident-1", "PENDING_VENDOR", { actorId: "user-1" });
    expect(tx.slaInstance.update).not.toHaveBeenCalled();
  });

  it("shifts resolveDueAt forward by the elapsed pause duration on resume", async () => {
    const pausedAt = new Date(Date.now() - 10 * 60_000); // paused 10 minutes ago
    const resolveDueAt = new Date("2026-09-03T14:00:00Z");
    const { service, tx } = makeService({
      txSlaInstance: {
        findFirst: jest.fn().mockResolvedValue(baseInstance({ pausedAt, resolveDueAt })),
      },
    });
    await service.onResumed(tx as never, "incident-1", { actorId: "user-1" });

    const call = (tx.slaInstance.update as jest.Mock).mock.calls[0][0];
    expect(call.data.pausedAt).toBeNull();
    expect(call.data.pausedMinutes).toBeGreaterThanOrEqual(9); // ~10 min, timing-tolerant
    expect(call.data.resolveDueAt.getTime()).toBeGreaterThan(resolveDueAt.getTime());
  });

  it("no-ops on resume when the clock wasn't actually paused", async () => {
    const { service, tx } = makeService({
      txSlaInstance: { findFirst: jest.fn().mockResolvedValue(baseInstance({ pausedAt: null })) },
    });
    await service.onResumed(tx as never, "incident-1", { actorId: "user-1" });
    expect(tx.slaInstance.update).not.toHaveBeenCalled();
  });
});

describe("SlaService.onPriorityChanged", () => {
  it("recomputes ackDueAt and resolveDueAt when neither clock has stopped yet", async () => {
    const { service, tx, prisma } = makeService({
      slaPolicyFindFirst: jest.fn().mockResolvedValue(basePolicy({ id: "policy-p2", priority: Priority.P2 })),
    });
    await service.onPriorityChanged(
      tx as never,
      { id: "incident-1", siteId: "site-a" },
      Priority.P2,
      { actorId: "user-1" },
    );
    expect(prisma.slaPolicy.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ priority: Priority.P2 }) }),
    );
    const call = (tx.slaInstance.update as jest.Mock).mock.calls[0][0];
    expect(call.data.slaPolicyId).toBe("policy-p2");
    expect(call.data.ackDueAt).toBeInstanceOf(Date);
    expect(call.data.resolveDueAt).toBeInstanceOf(Date);
  });

  it("leaves ackDueAt untouched once the ack clock has already stopped", async () => {
    const { service, tx } = makeService({
      txSlaInstance: {
        findFirst: jest.fn().mockResolvedValue(baseInstance({ ackedAt: new Date("2026-09-03T10:05:00Z") })),
      },
    });
    await service.onPriorityChanged(
      tx as never,
      { id: "incident-1", siteId: "site-a" },
      Priority.P2,
      { actorId: "user-1" },
    );
    const call = (tx.slaInstance.update as jest.Mock).mock.calls[0][0];
    expect(call.data.ackDueAt).toBeUndefined();
    expect(call.data.resolveDueAt).toBeInstanceOf(Date);
  });
});

describe("SlaService.onReopened", () => {
  it("clears resolvedAt when the instance was resolved", async () => {
    const { service, tx } = makeService({
      txSlaInstance: {
        findFirst: jest.fn().mockResolvedValue(baseInstance({ resolvedAt: new Date() })),
      },
    });
    await service.onReopened(tx as never, "incident-1", { actorId: "user-1" });
    expect(tx.slaInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { resolvedAt: null } }),
    );
  });

  it("no-ops when the instance was never resolved", async () => {
    const { service, tx } = makeService();
    await service.onReopened(tx as never, "incident-1", { actorId: "user-1" });
    expect(tx.slaInstance.update).not.toHaveBeenCalled();
  });
});
