import { BadRequestException } from "@nestjs/common";
import { IncidentStatus, Priority, UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { InboxService } from "../inbox/inbox.service";
import { IncidentCustomerService } from "./incident-customer.service";
import { IncidentsService } from "./incidents.service";

const CUSTOMER = {
  id: "cust-1",
  email: "client@example.com",
  role: UserRole.CLIENT_MANAGER_VIEWER,
  isActive: true,
} as AuthenticatedUser;

const T0 = new Date("2026-09-30T08:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function incident(overrides: Record<string, unknown> = {}) {
  return {
    id: "inc-1",
    incidentNo: "INC-000042",
    status: IncidentStatus.IN_PROGRESS,
    priority: Priority.P2,
    shortDescription: "Rack PDU alarm",
    ownerUserId: "eng-1",
    ownerGroupId: "grp-1",
    reportedByUserId: "cust-1",
    createdAt: T0,
    ...overrides,
  };
}

function makeService(
  opts: { incident?: ReturnType<typeof incident>; events?: unknown[]; replies?: number } = {},
) {
  const tx = {
    incidentComment: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "c-1", ...data })),
    },
    incidentEvent: {
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: `ev-${data.eventType}`, createdAt: at(90), ...data }),
        ),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    incidentEvent: { findMany: jest.fn().mockResolvedValue(opts.events ?? []) },
    incidentComment: { count: jest.fn().mockResolvedValue(opts.replies ?? 0) },
    user: { findUnique: jest.fn().mockResolvedValue({ displayName: "Rahul" }) },
    supportGroup: { findUnique: jest.fn().mockResolvedValue({ name: "Windows & Servers" }) },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const inbox = { notifyUsers: jest.fn().mockResolvedValue(undefined) };
  const incidents = {
    findOneScoped: jest.fn().mockResolvedValue(opts.incident ?? incident()),
    supportRecipientIds: jest.fn().mockResolvedValue(["eng-1", "desk-1"]),
  };
  const service = new IncidentCustomerService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    inbox as unknown as InboxService,
    incidents as unknown as IncidentsService,
  );
  return { service, prisma, tx, audit, inbox, incidents };
}

const statusEvent = (to: string, minutes: number) => ({
  eventType: "STATUS_CHANGE",
  payload: { to, reason: "staff only" },
  createdAt: at(minutes),
});

describe("IncidentCustomerService.getProgress", () => {
  it("summarises who's handling it and the status history", async () => {
    const { service } = makeService({
      events: [statusEvent("ASSIGNED", 5), statusEvent("ACKNOWLEDGED", 10)],
    });

    const progress = await service.getProgress("inc-1", CUSTOMER);

    expect(progress.handledBy).toEqual({ engineer: "Rahul", team: "Windows & Servers" });
    expect(progress.milestones.map((m) => m.status)).toEqual(["NEW", "ASSIGNED", "ACKNOWLEDGED"]);
    expect(progress.waitingOnCustomerSince).toBeNull();
    expect(progress.feedback).toBeNull();
  });

  it("reports waiting-on-customer and whether they've replied since", async () => {
    const { service, prisma } = makeService({
      incident: incident({ status: IncidentStatus.PENDING_CUSTOMER }),
      events: [statusEvent("IN_PROGRESS", 5), statusEvent("PENDING_CUSTOMER", 20)],
      replies: 1,
    });

    const progress = await service.getProgress("inc-1", CUSTOMER);

    expect(progress.waitingOnCustomerSince).toEqual(at(20));
    expect(progress.customerRepliedWhileWaiting).toBe(true);
    expect(prisma.incidentComment.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        authorId: "cust-1",
        isInternal: false,
        createdAt: { gt: at(20) },
      }),
    });
  });

  it("only counts feedback given after the latest resolution", async () => {
    const { service } = makeService({
      incident: incident({ status: IncidentStatus.RESOLVED }),
      events: [
        statusEvent("RESOLVED", 30),
        { eventType: "CUSTOMER_FEEDBACK", payload: { outcome: "NOT_FIXED" }, createdAt: at(40) },
        statusEvent("REOPENED", 45),
        statusEvent("IN_PROGRESS", 50),
        statusEvent("RESOLVED", 80),
      ],
    });

    await expect(service.getProgress("inc-1", CUSTOMER)).resolves.toMatchObject({ feedback: null });
  });

  it("has no handler names on an unassigned ticket", async () => {
    const { service } = makeService({
      incident: incident({ ownerUserId: null, ownerGroupId: null }),
    });

    await expect(service.getProgress("inc-1", CUSTOMER)).resolves.toMatchObject({
      handledBy: { engineer: null, team: null },
    });
  });
});

describe("IncidentCustomerService.submitFeedback", () => {
  const resolved = incident({ status: IncidentStatus.RESOLVED });

  it("records a confirmed fix, audits it and tells the handler and the desk", async () => {
    const { service, tx, audit, inbox, incidents } = makeService({ incident: resolved });

    const result = await service.submitFeedback(
      "inc-1",
      { outcome: "FIXED", comment: "All good now, thanks" },
      { actorId: "cust-1", correlationId: "corr-1" },
      CUSTOMER,
    );

    expect(tx.incidentComment.create).toHaveBeenCalledWith({
      data: {
        incidentId: "inc-1",
        authorId: "cust-1",
        body: "Confirmed: the issue is fixed.\n\nAll good now, thanks",
        isInternal: false,
      },
    });
    expect(tx.incidentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "CUSTOMER_FEEDBACK",
        payload: { outcome: "FIXED", commentId: "c-1" },
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CUSTOMER_FEEDBACK",
        entityId: "inc-1",
        correlationId: "corr-1",
      }),
      tx,
    );
    expect(incidents.supportRecipientIds).toHaveBeenCalledWith(resolved, true);
    expect(inbox.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "CUSTOMER_RESPONDED",
        userIds: ["eng-1", "desk-1"],
        title: "INC-000042: customer confirmed the fix, ready to close",
        level: 2,
      }),
    );
    expect(result.outcome).toBe("FIXED");
  });

  it("needs a description of what's still wrong for NOT_FIXED", async () => {
    const { service, tx } = makeService({ incident: resolved });

    await expect(
      service.submitFeedback("inc-1", { outcome: "NOT_FIXED" }, { actorId: "cust-1" }, CUSTOMER),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.incidentComment.create).not.toHaveBeenCalled();
  });

  it("posts the customer's words for NOT_FIXED", async () => {
    const { service, tx, inbox } = makeService({ incident: resolved });

    await service.submitFeedback(
      "inc-1",
      { outcome: "NOT_FIXED", comment: "Alarm is back" },
      { actorId: "cust-1" },
      CUSTOMER,
    );

    expect(tx.incidentComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ body: "Not fixed yet: Alarm is back" }),
    });
    expect(inbox.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({ title: "INC-000042: customer says it's not fixed" }),
    );
  });

  it("refuses feedback unless the ticket is resolved", async () => {
    const { service } = makeService({ incident: incident({ status: IncidentStatus.IN_PROGRESS }) });

    await expect(
      service.submitFeedback("inc-1", { outcome: "FIXED" }, { actorId: "cust-1" }, CUSTOMER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("still succeeds when the notification can't be sent", async () => {
    const { service, incidents } = makeService({ incident: resolved });
    incidents.supportRecipientIds.mockRejectedValue(new Error("db down"));

    await expect(
      service.submitFeedback("inc-1", { outcome: "FIXED" }, { actorId: "cust-1" }, CUSTOMER),
    ).resolves.toMatchObject({ outcome: "FIXED" });
  });
});
