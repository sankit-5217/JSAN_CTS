import { Priority } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SlaEscalationScanner } from "./sla-escalation.scanner";
import { SlaTimersPublisher } from "./sla-timers.publisher";

const NOW = new Date("2026-09-03T14:00:00Z");

function basePolicy(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "policy-p1",
    priority: Priority.P1,
    ackTargetMinutes: 15,
    resolveTargetMinutes: 240, // 4h
    escalationThresholdsPercent: [50, 75, 90],
    ...overrides,
  };
}

function baseInstance(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "instance-1",
    incidentId: "incident-1",
    slaPolicyId: "policy-p1",
    ackDueAt: null,
    ackedAt: new Date("2026-09-03T10:05:00Z"), // already acked — only resolve clock is open below
    resolveDueAt: new Date("2026-09-03T14:00:00Z"), // NOW == due -> 100% elapsed (breach)
    resolvedAt: null,
    pausedAt: null,
    pausedMinutes: 0,
    firedMilestones: [] as string[],
    breached: false,
    slaPolicy: basePolicy(),
    incident: {
      id: "incident-1",
      incidentNo: "INC-000042",
      shortDescription: "Server unresponsive",
      priority: Priority.P1,
      owner: { displayName: "Sam Engineer", email: "sam@corp.example" },
      site: {
        code: "SITE01",
        contacts: [
          { name: "On-call Lead", email: "oncall@corp.example", isOnCall: true },
          { name: "Off-hours Contact", email: "offhours@corp.example", isOnCall: false },
        ],
      },
    },
    ...overrides,
  };
}

function makeScanner(
  overrides: {
    findMany?: jest.Mock;
    txSlaInstance?: Partial<Record<string, jest.Mock>>;
  } = {},
) {
  const txSlaInstance = {
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides.txSlaInstance,
  };
  const tx = {
    slaInstance: txSlaInstance,
    incidentEvent: { create: jest.fn().mockResolvedValue(undefined) },
  };

  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    slaInstance: {
      findMany: overrides.findMany ?? jest.fn().mockResolvedValue([baseInstance()]),
    },
  } as unknown as PrismaService;

  const auditService = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const publisher = { enqueue: jest.fn().mockResolvedValue(undefined) } as unknown as SlaTimersPublisher;

  return {
    scanner: new SlaEscalationScanner(prisma, auditService, publisher),
    prisma,
    auditService,
    publisher,
    tx,
  };
}

describe("SlaEscalationScanner.scan", () => {
  it("fires a breach milestone when now has reached the due date, writing evidence and enqueueing delivery", async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { scanner, tx, auditService, publisher } = makeScanner();

    await scanner.scan();

    expect(tx.slaInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          firedMilestones: { push: "RESOLVE_BREACH" },
          breached: true,
        }),
      }),
    );
    expect(tx.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "SLA_EVENT",
          actorId: null,
          payload: expect.objectContaining({ slaKind: "RESOLVE", milestone: "RESOLVE_BREACH" }),
        }),
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "SlaInstance", action: "SLA_EVENT", actorId: null }),
      tx,
    );
    expect(publisher.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ kind: "SLA_BREACHED" }) }),
      "sla:instance-1:RESOLVE_BREACH",
    );

    jest.useRealTimers();
  });

  it("fires a warning milestone (not breach) partway through the target", async () => {
    // 4h target, due at 14:00 -> 75% elapsed = 3h in = 13:00.
    jest.useFakeTimers().setSystemTime(new Date("2026-09-03T13:00:00Z"));
    const { scanner, tx, publisher } = makeScanner();

    await scanner.scan();

    expect(tx.slaInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { firedMilestones: { push: "RESOLVE_75" } } }),
    );
    expect(publisher.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ kind: "SLA_WARNING", slaKind: "RESOLUTION" }),
      }),
      "sla:instance-1:RESOLVE_75",
    );

    jest.useRealTimers();
  });

  it("does not re-fire a milestone already in firedMilestones", async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { scanner, tx, publisher } = makeScanner({
      findMany: jest
        .fn()
        .mockResolvedValue([baseInstance({ firedMilestones: ["RESOLVE_50", "RESOLVE_75", "RESOLVE_90", "RESOLVE_BREACH"] })]),
    });

    await scanner.scan();

    expect(tx.slaInstance.update).not.toHaveBeenCalled();
    expect(publisher.enqueue).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it("skips the resolve clock while paused, but still evaluates the ack clock", async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { scanner, tx } = makeScanner({
      findMany: jest.fn().mockResolvedValue([
        baseInstance({
          pausedAt: new Date("2026-09-03T12:00:00Z"),
          ackedAt: null,
          ackDueAt: new Date("2026-09-03T13:00:00Z"), // already past -> breach (and every lower threshold)
        }),
      ]),
    });

    await scanner.scan();

    const milestones = (tx.slaInstance.update as jest.Mock).mock.calls.map(
      ([arg]) => arg.data.firedMilestones.push,
    );
    expect(milestones).toContain("ACK_BREACH");
    // RESOLVE was skipped entirely because the clock is paused — every
    // fired milestone this tick must be an ACK_* one.
    expect(milestones.every((m: string) => m.startsWith("ACK_"))).toBe(true);

    jest.useRealTimers();
  });

  it("skips delivery (but still records evidence) when there's no owner or on-call contact", async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { scanner, tx, publisher } = makeScanner({
      findMany: jest.fn().mockResolvedValue([
        baseInstance({
          incident: {
            ...baseInstance().incident,
            owner: null,
            site: { code: "SITE01", contacts: [] },
          },
        }),
      ]),
    });

    await scanner.scan();

    expect(tx.slaInstance.update).toHaveBeenCalled(); // evidence still recorded
    expect(publisher.enqueue).not.toHaveBeenCalled(); // nobody to notify

    jest.useRealTimers();
  });

  it("de-dupes an owner who is also listed as an on-call contact", async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { scanner, publisher } = makeScanner({
      findMany: jest.fn().mockResolvedValue([
        baseInstance({
          incident: {
            ...baseInstance().incident,
            owner: { displayName: "Sam", email: "oncall@corp.example" },
          },
        }),
      ]),
    });

    await scanner.scan();

    const call = (publisher.enqueue as jest.Mock).mock.calls[0][0];
    expect(call.recipients.to).toHaveLength(1);

    jest.useRealTimers();
  });

  it("one instance failing doesn't stop the rest of the scan", async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { scanner, tx } = makeScanner({
      findMany: jest.fn().mockResolvedValue([
        baseInstance({ id: "instance-bad", incident: null }), // will throw when reading incident.owner
        baseInstance({ id: "instance-1" }),
      ]),
    });

    await expect(scanner.scan()).resolves.toBeUndefined();
    // The good instance's update still went through despite the bad one throwing.
    expect(tx.slaInstance.update).toHaveBeenCalled();

    jest.useRealTimers();
  });
});
