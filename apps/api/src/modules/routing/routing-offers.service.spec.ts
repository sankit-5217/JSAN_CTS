import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { RoutingOfferStatus, UserRole } from "@prisma/client";
import { NotificationsPublisher } from "../../common/notifications/notifications.publisher";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { InboxService } from "../inbox/inbox.service";
import { IncidentsService } from "../incidents/incidents.service";
import { CategoryTeamsService } from "./category-teams.service";
import { RoutingOffersService } from "./routing-offers.service";
import {
  DEFAULT_ROUTING_SETTINGS,
  RoutingCandidate,
  RoutingService,
  RoutingSuggestions,
} from "./routing.service";

const NOW = new Date("2026-09-24T08:00:00Z");

const ENGINEER = {
  id: "eng-1",
  email: "eng1@example.com",
  role: UserRole.SITE_ENGINEER,
  isActive: true,
} as AuthenticatedUser;

function incident(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "inc-1",
    incidentNo: "INC-000100",
    siteId: "site-1",
    shortDescription: "Array degraded",
    priority: "P2",
    category: "STORAGE_FAILURE",
    status: "NEW",
    ownerUserId: null,
    ownerGroupId: null,
    ...overrides,
  };
}

function candidate(userId: string): RoutingCandidate {
  return {
    userId,
    displayName: `Name ${userId}`,
    email: `${userId}@example.com`,
    shiftLabel: "Day",
    isOnCall: false,
    openIncidentCount: 0,
    workloadScore: 0,
    isCurrentOwner: false,
    inTeam: false,
  };
}

function offer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "offer-1",
    incidentId: "inc-1",
    userId: "eng-1",
    status: RoutingOfferStatus.PENDING,
    expiresAt: new Date("2026-09-24T08:05:00Z"),
    respondedAt: null,
    declineReason: null,
    createdAt: new Date("2026-09-24T08:00:00Z"),
    updatedAt: new Date("2026-09-24T08:00:00Z"),
    user: { displayName: "Name eng-1", email: "eng-1@example.com" },
    ...overrides,
  };
}

function makeService(
  opts: {
    policy?: { autoAssignEnabled: boolean; offerTimeoutMinutes: number } | null;
    incident?: ReturnType<typeof incident>;
    candidates?: RoutingCandidate[];
    /** Offers already on the incident (offerNext / listForIncident). */
    previous?: ReturnType<typeof offer>[];
    /** Overdue PENDING offers (expireOverdue). */
    due?: ReturnType<typeof offer>[];
    pending?: ReturnType<typeof offer> | null;
    updateCount?: number;
    autoAssign?: jest.Mock;
    desk?: { id: string; email: string; displayName: string }[];
    /** Engineers holding an open offer on some other ticket. */
    busy?: string[];
  } = {},
) {
  const prisma = {
    $transaction: jest.fn(),
    routingPolicy: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.policy === undefined
            ? { autoAssignEnabled: true, offerTimeoutMinutes: 10 }
            : opts.policy,
        ),
    },
    routingOffer: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            where.expiresAt
              ? (opts.due ?? [])
              : where.userId
                ? (opts.busy ?? [])
                    .filter((id) => where.userId.in.includes(id))
                    .map((userId) => ({ userId }))
                : (opts.previous ?? []),
          ),
        ),
      findFirst: jest.fn().mockResolvedValue(opts.pending === undefined ? offer() : opts.pending),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: "offer-new", status: RoutingOfferStatus.PENDING, ...data }),
        ),
      updateMany: jest.fn().mockResolvedValue({ count: opts.updateCount ?? 1 }),
      findUniqueOrThrow: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve({ ...offer({ id: where.id }), status: "CLOSED" }),
        ),
      update: jest
        .fn()
        .mockImplementation(({ where, data }) =>
          Promise.resolve({ ...offer({ id: where.id }), ...data }),
        ),
    },
    user: { findMany: jest.fn().mockResolvedValue(opts.desk ?? []) },
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));

  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const incidentsService = {
    findOne: jest.fn().mockResolvedValue(opts.incident ?? incident()),
    findOneScoped: jest.fn().mockResolvedValue(opts.incident ?? incident()),
    autoAssign: opts.autoAssign ?? jest.fn().mockResolvedValue({ id: "inc-1" }),
    recordRoutingEvent: jest.fn().mockResolvedValue(undefined),
  };
  const suggestions: RoutingSuggestions = {
    incidentId: "inc-1",
    category: "STORAGE_FAILURE",
    asOf: NOW.toISOString(),
    requiredSkills: [],
    candidates: opts.candidates ?? [candidate("eng-1"), candidate("eng-2")],
    reason: (opts.candidates ?? [1]).length === 0 ? "NO_QUALIFIED_ENGINEER" : null,
    uncoveredSkills: [],
    team: null,
    teamFallback: false,
  };
  const routingService = {
    rank: jest.fn().mockResolvedValue(suggestions),
    // incident() is a P2; 10 minutes keeps the expiry arithmetic readable.
    getSettings: jest.fn().mockResolvedValue({
      ...DEFAULT_ROUTING_SETTINGS,
      offerTimeoutP2Minutes: 10,
    }),
  };
  const inbox = { notifyUsers: jest.fn().mockResolvedValue(undefined) };
  const categoryTeams = { teamForCategory: jest.fn().mockResolvedValue(null) };
  const notifications = { enqueue: jest.fn().mockResolvedValue(undefined) };

  const service = new RoutingOffersService(
    prisma as unknown as PrismaService,
    auditService as unknown as AuditService,
    incidentsService as unknown as IncidentsService,
    routingService as unknown as RoutingService,
    inbox as unknown as InboxService,
    notifications as unknown as NotificationsPublisher,
    categoryTeams as unknown as CategoryTeamsService,
  );
  return {
    service,
    prisma,
    auditService,
    incidentsService,
    routingService,
    inbox,
    notifications,
    categoryTeams,
  };
}

const CREATED = { incidentId: "inc-1", siteId: "site-1", correlationId: "corr-1" };

describe("RoutingOffersService.onIncidentCreated", () => {
  it("does nothing when the site has no policy", async () => {
    const { service, prisma } = makeService({ policy: null });
    await service.onIncidentCreated(CREATED, NOW);
    expect(prisma.routingOffer.create).not.toHaveBeenCalled();
  });

  it("does nothing when the site's auto-routing is off", async () => {
    const { service, prisma } = makeService({
      policy: { autoAssignEnabled: false, offerTimeoutMinutes: 5 },
    });
    await service.onIncidentCreated(CREATED, NOW);
    expect(prisma.routingOffer.create).not.toHaveBeenCalled();
  });

  it("offers the ticket to the top candidate for the site's accept window, leaving it NEW", async () => {
    const { service, prisma, auditService, incidentsService, inbox, notifications } = makeService();

    await service.onIncidentCreated(CREATED, NOW);

    const expiresAt = new Date("2026-09-24T08:10:00Z");
    expect(prisma.routingOffer.create).toHaveBeenCalledWith({
      data: { incidentId: "inc-1", userId: "eng-1", expiresAt },
    });
    expect(incidentsService.autoAssign).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "RoutingOffer",
        action: "CREATE",
        actorId: null,
        correlationId: "corr-1",
      }),
      prisma,
    );
    expect(incidentsService.recordRoutingEvent).toHaveBeenCalledWith(
      "inc-1",
      null,
      expect.objectContaining({ action: "OFFERED", userId: "eng-1", round: 1 }),
    );
    expect(inbox.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "INCIDENT_OFFERED",
        userIds: ["eng-1"],
        title: "INC-000100 offered to you: accept within 10 min",
        dedupeKey: "offer:offer-new",
      }),
    );
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ kind: "INCIDENT_OFFERED", timeoutMinutes: 10 }),
        recipients: { to: [{ name: "Name eng-1", email: "eng-1@example.com" }] },
      }),
      "INCIDENT_OFFERED:offer-new",
    );
  });

  it("leaves the ticket for the desk, without an alert, when nobody qualifies at all", async () => {
    const { service, prisma, inbox } = makeService({ candidates: [] });
    await service.onIncidentCreated(CREATED, NOW);
    expect(prisma.routingOffer.create).not.toHaveBeenCalled();
    expect(inbox.notifyUsers).not.toHaveBeenCalled();
  });

  it("swallows failures so incident creation is never affected", async () => {
    const { service, routingService } = makeService();
    routingService.rank.mockRejectedValue(new Error("db down"));
    await expect(service.onIncidentCreated(CREATED, NOW)).resolves.toBeUndefined();
  });
});

describe("RoutingOffersService.offerNext", () => {
  it("skips engineers who already had an offer for this ticket", async () => {
    const { service, prisma } = makeService({
      previous: [offer({ status: RoutingOfferStatus.DECLINED })],
    });
    await service.offerNext("inc-1", NOW);
    expect(prisma.routingOffer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "eng-2" }),
    });
  });

  it("stops offering once the site has turned auto-routing off", async () => {
    const { service, prisma, inbox } = makeService({
      policy: { autoAssignEnabled: false, offerTimeoutMinutes: 5 },
      previous: [offer({ status: RoutingOfferStatus.EXPIRED })],
    });
    await service.offerNext("inc-1", NOW);
    expect(prisma.routingOffer.create).not.toHaveBeenCalled();
    expect(inbox.notifyUsers).not.toHaveBeenCalled();
  });

  it("gives a P1 the site's P1 accept window", async () => {
    const { service, prisma } = makeService({ incident: incident({ priority: "P1" }) });
    await service.offerNext("inc-1", NOW);
    expect(prisma.routingOffer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ expiresAt: new Date("2026-09-24T08:02:00Z") }),
    });
  });

  it("passes over an engineer already holding another offer, below P1", async () => {
    const { service, prisma } = makeService({ busy: ["eng-1"] });
    await service.offerNext("inc-1", NOW);
    expect(prisma.routingOffer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "eng-2" }),
    });
  });

  it("still offers when every candidate is holding another offer", async () => {
    const { service, prisma } = makeService({ busy: ["eng-1", "eng-2"] });
    await service.offerNext("inc-1", NOW);
    expect(prisma.routingOffer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "eng-1" }),
    });
  });

  it("offers a P1 to the best engineer even if they hold another offer", async () => {
    const { service, prisma } = makeService({
      incident: incident({ priority: "P1" }),
      busy: ["eng-1"],
    });
    await service.offerNext("inc-1", NOW);
    expect(prisma.routingOffer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "eng-1" }),
    });
  });

  it("never opens a second offer while one is pending", async () => {
    const { service, prisma } = makeService({ previous: [offer()] });
    await service.offerNext("inc-1", NOW);
    expect(prisma.routingOffer.create).not.toHaveBeenCalled();
  });

  it("does nothing once the ticket has an owner", async () => {
    const { service, prisma, routingService } = makeService({
      incident: incident({ status: "ASSIGNED", ownerUserId: "someone" }),
    });
    await service.offerNext("inc-1", NOW);
    expect(routingService.rank).not.toHaveBeenCalled();
    expect(prisma.routingOffer.create).not.toHaveBeenCalled();
  });

  it("hands the ticket back to the service desk when everyone has declined or timed out", async () => {
    const { service, prisma, incidentsService, inbox, notifications } = makeService({
      previous: [
        offer({ id: "o1", userId: "eng-1", status: RoutingOfferStatus.DECLINED }),
        offer({
          id: "o2",
          userId: "eng-2",
          status: RoutingOfferStatus.EXPIRED,
          user: { displayName: "Name eng-2", email: "eng-2@example.com" },
        }),
      ],
      desk: [{ id: "desk-1", email: "desk@example.com", displayName: "Desk" }],
    });

    await service.offerNext("inc-1", NOW);

    expect(prisma.routingOffer.create).not.toHaveBeenCalled();
    expect(incidentsService.recordRoutingEvent).toHaveBeenCalledWith("inc-1", null, {
      action: "UNACCEPTED",
      offeredTo: ["Name eng-1", "Name eng-2"],
    });
    expect(inbox.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "INCIDENT_OFFER_UNACCEPTED",
        userIds: ["desk-1"],
        dedupeKey: "unaccepted:inc-1:2",
      }),
    );
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          kind: "INCIDENT_OFFER_UNACCEPTED",
          offeredTo: ["Name eng-1", "Name eng-2"],
        }),
        recipients: { to: [{ name: "Desk", email: "desk@example.com" }] },
      }),
      "INCIDENT_OFFER_UNACCEPTED:inc-1:2",
    );
  });
});

describe("RoutingOffersService.accept", () => {
  it("assigns the ticket to the engineer holding the open offer", async () => {
    const { service, prisma, incidentsService, auditService } = makeService();

    const result = await service.accept(
      "inc-1",
      ENGINEER,
      { actorId: "eng-1", correlationId: "c" },
      NOW,
    );

    expect(prisma.routingOffer.updateMany).toHaveBeenCalledWith({
      where: { id: "offer-1", status: RoutingOfferStatus.PENDING },
      data: { status: RoutingOfferStatus.ACCEPTED, respondedAt: NOW },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "RoutingOffer", action: "ACCEPTED", actorId: "eng-1" }),
      prisma,
    );
    expect(incidentsService.autoAssign).toHaveBeenCalledWith(
      "inc-1",
      "eng-1",
      "c",
      "eng-1",
      undefined,
    );
    expect(result).toMatchObject({ id: "offer-1", displayName: "Name eng-1" });
  });

  it("records the category's team on the ticket when accepted", async () => {
    const { service, incidentsService, categoryTeams } = makeService();
    categoryTeams.teamForCategory.mockResolvedValue({
      id: "grp-storage",
      name: "Storage team",
      memberIds: ["eng-1"],
    });
    await service.accept("inc-1", ENGINEER, { actorId: "eng-1", correlationId: "c" }, NOW);
    expect(categoryTeams.teamForCategory).toHaveBeenCalledWith("STORAGE_FAILURE");
    expect(incidentsService.autoAssign).toHaveBeenCalledWith(
      "inc-1",
      "eng-1",
      "c",
      "eng-1",
      "grp-storage",
    );
  });

  it("checks the caller can see the incident first", async () => {
    const { service, incidentsService } = makeService();
    incidentsService.findOneScoped.mockRejectedValue(new ForbiddenException());
    await expect(
      service.accept("inc-1", ENGINEER, { actorId: "eng-1" }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("404s when there's no open offer", async () => {
    const { service } = makeService({ pending: null });
    await expect(
      service.accept("inc-1", ENGINEER, { actorId: "eng-1" }, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuses an engineer the offer wasn't made to", async () => {
    const { service, incidentsService } = makeService({ pending: offer({ userId: "eng-2" }) });
    await expect(
      service.accept("inc-1", ENGINEER, { actorId: "eng-1" }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(incidentsService.autoAssign).not.toHaveBeenCalled();
  });

  it("refuses an offer past its expiry even before the sweep runs", async () => {
    const { service } = makeService({
      pending: offer({ expiresAt: new Date("2026-09-24T07:59:00Z") }),
    });
    await expect(
      service.accept("inc-1", ENGINEER, { actorId: "eng-1" }, NOW),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("loses cleanly when the sweep or a decline got there first", async () => {
    const { service, incidentsService } = makeService({ updateCount: 0 });
    await expect(
      service.accept("inc-1", ENGINEER, { actorId: "eng-1" }, NOW),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(incidentsService.autoAssign).not.toHaveBeenCalled();
  });

  it("cancels the offer when the desk assigned the ticket in the meantime", async () => {
    const { service, prisma } = makeService({ autoAssign: jest.fn().mockResolvedValue(null) });
    await expect(
      service.accept("inc-1", ENGINEER, { actorId: "eng-1" }, NOW),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.routingOffer.update).toHaveBeenCalledWith({
      where: { id: "offer-1" },
      data: { status: RoutingOfferStatus.CANCELLED },
    });
  });

  it("cancels the offer, and rethrows, when the assign itself fails", async () => {
    const { service, prisma } = makeService({
      autoAssign: jest.fn().mockRejectedValue(new Error("boom")),
    });
    await expect(service.accept("inc-1", ENGINEER, { actorId: "eng-1" }, NOW)).rejects.toThrow(
      "boom",
    );
    expect(prisma.routingOffer.update).toHaveBeenCalledWith({
      where: { id: "offer-1" },
      data: { status: RoutingOfferStatus.CANCELLED },
    });
  });
});

describe("RoutingOffersService.decline", () => {
  it("records the decline with its reason and offers the ticket to the next engineer", async () => {
    const { service, prisma, incidentsService } = makeService({
      // Once declined, the first offer is history for the next round.
      previous: [offer({ status: RoutingOfferStatus.DECLINED })],
    });

    await service.decline(
      "inc-1",
      ENGINEER,
      "  On site at another DC  ",
      { actorId: "eng-1" },
      NOW,
    );

    expect(prisma.routingOffer.updateMany).toHaveBeenCalledWith({
      where: { id: "offer-1", status: RoutingOfferStatus.PENDING },
      data: {
        status: RoutingOfferStatus.DECLINED,
        respondedAt: NOW,
        declineReason: "On site at another DC",
      },
    });
    expect(incidentsService.recordRoutingEvent).toHaveBeenCalledWith(
      "inc-1",
      "eng-1",
      expect.objectContaining({ action: "DECLINED", reason: "On site at another DC" }),
    );
    expect(prisma.routingOffer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "eng-2" }),
    });
  });

  it("stores a blank reason as none", async () => {
    const { service, prisma } = makeService({ previous: [offer({ status: "DECLINED" })] });
    await service.decline("inc-1", ENGINEER, "   ", { actorId: "eng-1" }, NOW);
    expect(prisma.routingOffer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ declineReason: null }) }),
    );
  });

  it("refuses an engineer the offer wasn't made to", async () => {
    const { service } = makeService({ pending: offer({ userId: "eng-2" }) });
    await expect(
      service.decline("inc-1", ENGINEER, undefined, { actorId: "eng-1" }, NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("RoutingOffersService.expireOverdue", () => {
  it("expires overdue offers and moves each ticket to the next engineer", async () => {
    const { service, prisma, incidentsService, auditService } = makeService({
      due: [offer()],
      previous: [offer({ status: RoutingOfferStatus.EXPIRED })],
    });

    await expect(service.expireOverdue(NOW)).resolves.toBe(1);

    expect(prisma.routingOffer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: RoutingOfferStatus.PENDING, expiresAt: { lte: NOW } },
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "EXPIRED", actorId: null }),
      prisma,
    );
    expect(incidentsService.recordRoutingEvent).toHaveBeenCalledWith(
      "inc-1",
      null,
      expect.objectContaining({ action: "EXPIRED", userId: "eng-1" }),
    );
    expect(prisma.routingOffer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "eng-2" }),
    });
  });

  it("skips an offer that was answered between the read and the write", async () => {
    const { service, prisma, incidentsService } = makeService({ due: [offer()], updateCount: 0 });
    await expect(service.expireOverdue(NOW)).resolves.toBe(0);
    expect(incidentsService.recordRoutingEvent).not.toHaveBeenCalled();
    expect(prisma.routingOffer.create).not.toHaveBeenCalled();
  });
});

describe("RoutingOffersService.onIncidentUpdated", () => {
  const assigned = {
    incidentId: "inc-1",
    status: "ASSIGNED",
    ownerUserId: "eng-9",
    ownerGroupId: null,
    actorId: "desk-1",
  };

  it("cancels the open offer when the desk assigns the ticket by hand", async () => {
    const { service, prisma, auditService } = makeService({ previous: [offer()] });
    await service.onIncidentUpdated(assigned);
    expect(prisma.routingOffer.updateMany).toHaveBeenCalledWith({
      where: { id: "offer-1", status: RoutingOfferStatus.PENDING },
      data: { status: RoutingOfferStatus.CANCELLED },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CANCELLED", actorId: "desk-1" }),
      prisma,
    );
  });

  it("leaves offers alone while the ticket is still NEW and unowned", async () => {
    const { service, prisma } = makeService({ previous: [offer()] });
    await service.onIncidentUpdated({ ...assigned, status: "NEW", ownerUserId: null });
    expect(prisma.routingOffer.findMany).not.toHaveBeenCalled();
  });
});

describe("RoutingOffersService.listForIncident", () => {
  it("returns the open offer and the full history, after the scoped fetch", async () => {
    const { service, incidentsService } = makeService({
      previous: [offer({ id: "o1", status: RoutingOfferStatus.DECLINED }), offer({ id: "o2" })],
    });
    const result = await service.listForIncident("inc-1", ENGINEER);
    expect(incidentsService.findOneScoped).toHaveBeenCalledWith("inc-1", ENGINEER);
    expect(result.pending).toMatchObject({ id: "o2", status: "PENDING" });
    expect(result.history.map((o) => o.id)).toEqual(["o1", "o2"]);
  });
});
