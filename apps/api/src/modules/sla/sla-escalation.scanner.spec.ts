import { Priority } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { InboxService } from "../inbox/inbox.service";
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
    userFindMany?: jest.Mock;
    notifyUsers?: jest.Mock;
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
    user: {
      findMany: overrides.userFindMany ?? jest.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;

  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const publisher = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  } as unknown as SlaTimersPublisher;

  const inbox = {
    notifyUsers: overrides.notifyUsers ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as InboxService;

  return {
    scanner: new SlaEscalationScanner(prisma, auditService, publisher, inbox),
    prisma,
    auditService,
    publisher,
    inbox,
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
      findMany: jest.fn().mockResolvedValue([
        baseInstance({
          firedMilestones: ["RESOLVE_50", "RESOLVE_75", "RESOLVE_90", "RESOLVE_BREACH"],
        }),
      ]),
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

  it("notifies every active, emailed member of the incident's assigned support group", async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { scanner, publisher } = makeScanner({
      findMany: jest.fn().mockResolvedValue([
        baseInstance({
          incident: {
            ...baseInstance().incident,
            owner: null,
            site: { code: "SITE01", contacts: [] },
            ownerGroup: {
              members: [
                { user: { displayName: "Team A", email: "a@corp.example", isActive: true } },
                { user: { displayName: "Team B", email: "b@corp.example", isActive: true } },
                // excluded: inactive, and no email on file
                { user: { displayName: "Left Co", email: "left@corp.example", isActive: false } },
                { user: { displayName: "No Email", email: "", isActive: true } },
              ],
            },
          },
        }),
      ]),
    });

    await scanner.scan();

    const call = (publisher.enqueue as jest.Mock).mock.calls[0][0];
    expect(call.recipients.to).toEqual(
      expect.arrayContaining([
        { name: "Team A", email: "a@corp.example" },
        { name: "Team B", email: "b@corp.example" },
      ]),
    );
    expect(call.recipients.to).toHaveLength(2);

    jest.useRealTimers();
  });

  it("notifies the individual owner AND the assigned team together, not the team only as a fallback", async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { scanner, publisher } = makeScanner({
      findMany: jest.fn().mockResolvedValue([
        baseInstance({
          incident: {
            ...baseInstance().incident,
            ownerGroup: {
              members: [
                { user: { displayName: "Team A", email: "a@corp.example", isActive: true } },
              ],
            },
          },
        }),
      ]),
    });

    await scanner.scan();

    const call = (publisher.enqueue as jest.Mock).mock.calls[0][0];
    expect(call.recipients.to).toEqual(
      expect.arrayContaining([
        { name: "Sam Engineer", email: "sam@corp.example" },
        { name: "On-call Lead", email: "oncall@corp.example" },
        { name: "Team A", email: "a@corp.example" },
      ]),
    );

    jest.useRealTimers();
  });

  it("no longer drops delivery when the ticket has only a team assigned, no individual owner", async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { scanner, publisher } = makeScanner({
      findMany: jest.fn().mockResolvedValue([
        baseInstance({
          incident: {
            ...baseInstance().incident,
            owner: null,
            site: { code: "SITE01", contacts: [] },
            ownerGroup: {
              members: [
                { user: { displayName: "Team A", email: "a@corp.example", isActive: true } },
              ],
            },
          },
        }),
      ]),
    });

    await scanner.scan();

    expect(publisher.enqueue).toHaveBeenCalled();

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

describe("SlaEscalationScanner in-app notifications", () => {
  afterEach(() => jest.useRealTimers());

  it("puts a breach in the bell of the owner, the team and any on-call contact who is a user", async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const userFindMany = jest.fn().mockResolvedValue([{ id: "oncall-user" }]);
    const { scanner, inbox } = makeScanner({
      userFindMany,
      findMany: jest.fn().mockResolvedValue([
        baseInstance({
          incident: {
            ...baseInstance().incident,
            owner: { id: "owner-1", displayName: "Sam Engineer", email: "sam@corp.example" },
            ownerGroup: {
              members: [
                {
                  user: {
                    id: "member-1",
                    displayName: "Team A",
                    email: "a@corp.example",
                    isActive: true,
                  },
                },
              ],
            },
          },
        }),
      ]),
    });

    await scanner.scan();

    expect(userFindMany).toHaveBeenCalledWith({
      where: { email: { in: ["oncall@corp.example"] } },
      select: { id: true },
    });
    expect(inbox.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "SLA_BREACHED",
        userIds: ["owner-1", "member-1", "oncall-user"],
        title: "Resolution SLA breached on INC-000042",
        entityType: "INCIDENT",
        entityId: "incident-1",
        dedupeKey: "sla:instance-1:RESOLVE_BREACH",
      }),
    );
  });

  it("uses the warning kind for a milestone short of 100%", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-03T12:00:00Z")); // 50% of 4h
    const { scanner, inbox } = makeScanner();

    await scanner.scan();

    expect(inbox.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "SLA_WARNING", title: expect.stringContaining("50% used") }),
    );
  });

  it("still sends the email when the in-app write fails", async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { scanner, publisher } = makeScanner({
      userFindMany: jest.fn().mockRejectedValue(new Error("db down")),
    });

    await scanner.scan();

    expect(publisher.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ kind: "SLA_BREACHED" }) }),
      "sla:instance-1:RESOLVE_BREACH",
    );
  });
});
