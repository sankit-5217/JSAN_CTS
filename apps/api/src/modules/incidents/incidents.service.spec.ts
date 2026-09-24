import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { IncidentStatus, Priority, UserRole } from "@prisma/client";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { NotificationsPublisher } from "../../common/notifications/notifications.publisher";
import { StorageService } from "../../common/storage/storage.service";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthzService } from "../auth/authz.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { InboxService } from "../inbox/inbox.service";
import { SlaService } from "../sla/sla.service";
import { IncidentsService } from "./incidents.service";
import { OPEN_STATUSES } from "./incident-transitions";

const engineer: AuthenticatedUser = {
  id: "engineer-1",
  email: "engineer@example.com",
  role: UserRole.SITE_ENGINEER,
  isActive: true,
};

const otherEngineer: AuthenticatedUser = {
  id: "engineer-2",
  email: "engineer2@example.com",
  role: UserRole.SITE_ENGINEER,
  isActive: true,
};

const serviceDesk: AuthenticatedUser = {
  id: "servicedesk-1",
  email: "servicedesk@example.com",
  role: UserRole.SERVICE_DESK_NOC,
  isActive: true,
};

const clientViewer: AuthenticatedUser = {
  id: "viewer-1",
  email: "viewer@example.com",
  role: UserRole.CLIENT_MANAGER_VIEWER,
  isActive: true,
};

function baseIncident(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "incident-1",
    incidentNo: "INC-000001",
    siteId: "site-a",
    ciId: null,
    status: IncidentStatus.NEW,
    priority: Priority.P1,
    category: "HARDWARE_FAILURE",
    impact: "HIGH",
    urgency: "HIGH",
    shortDescription: "Server unresponsive",
    ownerGroupId: null,
    ownerUserId: null,
    reportedByUserId: null,
    acknowledgedAt: null,
    resolutionCategory: null,
    rootCauseSummary: null,
    restoredAt: null,
    closedAt: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

const baseCreateDto = {
  siteId: "site-a",
  category: "HARDWARE_FAILURE",
  impact: "HIGH",
  urgency: "HIGH",
  priority: Priority.P1,
  shortDescription: "Server unresponsive",
};

function makeService(
  overrides: {
    incidentFindUnique?: jest.Mock;
    txIncident?: Partial<Record<string, jest.Mock>>;
    canAccessSite?: jest.Mock;
    getAccessibleSiteIds?: jest.Mock;
    userFindUnique?: jest.Mock;
    userFindMany?: jest.Mock;
    supportGroupFindUnique?: jest.Mock;
    alertFindMany?: jest.Mock;
    incidentGroupBy?: jest.Mock;
    txUpdateMany?: jest.Mock;
  } = {},
) {
  const txIncident = {
    create: jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ ...baseIncident(), ...data })),
    update: jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ ...baseIncident(), ...data })),
    updateMany: overrides.txUpdateMany ?? jest.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: jest.fn().mockResolvedValue({
      ...baseIncident(),
      status: IncidentStatus.ASSIGNED,
      ownerUserId: "eng-1",
    }),
    ...overrides.txIncident,
  };
  const tx = {
    incident: txIncident,
    incidentEvent: {
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: "event-1", ...data })),
    },
    incidentComment: {
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: "comment-1", ...data })),
    },
    attachment: {
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: "attachment-1", ...data })),
      update: jest
        .fn()
        .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(1) }]),
  };

  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    incident: {
      findUnique: overrides.incidentFindUnique ?? jest.fn().mockResolvedValue(baseIncident()),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: overrides.incidentGroupBy ?? jest.fn().mockResolvedValue([]),
    },
    incidentComment: { findMany: jest.fn().mockResolvedValue([]) },
    incidentEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    attachment: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    user: {
      findUnique: overrides.userFindUnique ?? jest.fn().mockResolvedValue(null),
      findMany: overrides.userFindMany ?? jest.fn().mockResolvedValue([]),
    },
    supportGroup: {
      findUnique: overrides.supportGroupFindUnique ?? jest.fn().mockResolvedValue(null),
    },
    alert: {
      findMany: overrides.alertFindMany ?? jest.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;

  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const authzService = {
    canAccessSite: overrides.canAccessSite ?? jest.fn().mockResolvedValue(true),
    getAccessibleSiteIds: overrides.getAccessibleSiteIds ?? jest.fn().mockResolvedValue(null),
  } as unknown as AuthzService;

  const storageService = {
    putObject: jest.fn().mockResolvedValue(undefined),
    getSignedDownloadUrl: jest.fn().mockResolvedValue("https://signed.example/download"),
  } as unknown as StorageService;

  const slaService = {
    startForIncident: jest.fn().mockResolvedValue(undefined),
    onAcknowledged: jest.fn().mockResolvedValue(undefined),
    onResolved: jest.fn().mockResolvedValue(undefined),
    onPaused: jest.fn().mockResolvedValue(undefined),
    onResumed: jest.fn().mockResolvedValue(undefined),
    onPriorityChanged: jest.fn().mockResolvedValue(undefined),
    onReopened: jest.fn().mockResolvedValue(undefined),
    findForIncident: jest.fn().mockResolvedValue(null),
  } as unknown as SlaService;

  const notifications = {
    enqueue: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsPublisher;

  const events = { emit: jest.fn() } as unknown as EventEmitter2;

  const inbox = {
    notifyUsers: jest.fn().mockResolvedValue(undefined),
  } as unknown as InboxService;

  return {
    service: new IncidentsService(
      prisma,
      auditService,
      authzService,
      storageService,
      slaService,
      notifications,
      events,
      inbox,
    ),
    prisma,
    auditService,
    authzService,
    storageService,
    slaService,
    notifications,
    events,
    inbox,
    tx,
  };
}

describe("IncidentsService.create", () => {
  it("generates the incident number from the sequence and audits inside the same transaction", async () => {
    const { service, tx, auditService } = makeService();
    const result = await service.create(baseCreateDto, {
      actorId: "user-1",
      correlationId: "corr-1",
    });

    expect(result).toMatchObject({ incidentNo: "INC-000001", status: IncidentStatus.NEW });
    expect(tx.incident.create).toHaveBeenCalledTimes(1);
    expect(tx.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: "CREATED" }) }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "Incident", action: "CREATE" }),
      tx,
    );
  });

  it("notifies the service desk/NOC roster when a new ticket is raised", async () => {
    const { service, notifications } = makeService({
      userFindMany: jest
        .fn()
        .mockResolvedValue([{ email: "desk@corp.example", displayName: "Service Desk" }]),
    });

    const result = await service.create(baseCreateDto, { actorId: "user-1" });

    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ kind: "INCIDENT_CREATED" }),
        recipients: { to: [{ name: "Service Desk", email: "desk@corp.example" }] },
      }),
      `INCIDENT_CREATED:${result.id}:new`,
    );
  });

  it("includes the reporting customer on the new-ticket notification when self-reported", async () => {
    const { service, notifications } = makeService({
      userFindMany: jest
        .fn()
        .mockResolvedValue([{ email: "desk@corp.example", displayName: "Service Desk" }]),
      userFindUnique: jest
        .fn()
        .mockResolvedValue({ id: "customer-1", email: "jane@client.example", displayName: "Jane" }),
    });

    await service.create(baseCreateDto, { actorId: "user-1" }, "customer-1");

    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          kind: "INCIDENT_CREATED",
          reporter: { name: "Jane", email: "jane@client.example" },
        }),
      }),
      expect.any(String),
    );
  });

  it("skips the new-ticket notification (not the ticket itself) when no service desk user is on file", async () => {
    const { service, notifications } = makeService({
      userFindMany: jest.fn().mockResolvedValue([]),
    });
    const result = await service.create(baseCreateDto, { actorId: "user-1" });
    expect(result).toMatchObject({ incidentNo: "INC-000001" });
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });

  it("starts the SLA clock in the same transaction as the incident row", async () => {
    const { service, tx, slaService } = makeService();
    const result = await service.create(baseCreateDto, { actorId: "user-1" });
    expect(slaService.startForIncident).toHaveBeenCalledWith(
      tx,
      { id: result.id, siteId: result.siteId },
      result.priority,
      { actorId: "user-1" },
    );
  });
});

describe("IncidentsService.createFromCustomer", () => {
  const customerDto = {
    siteId: "site-a",
    category: "HARDWARE_FAILURE" as const,
    shortDescription: "Server showing a red fault light",
  };

  it("defaults impact/urgency/priority to MEDIUM/MEDIUM/P3 rather than letting the customer set them", async () => {
    const { service, tx } = makeService();
    const result = await service.createFromCustomer(
      customerDto,
      { actorId: clientViewer.id },
      clientViewer,
    );

    expect(result).toMatchObject({ impact: "MEDIUM", urgency: "MEDIUM", priority: Priority.P3 });
    expect(tx.incident.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          impact: "MEDIUM",
          urgency: "MEDIUM",
          priority: Priority.P3,
        }),
      }),
    );
  });

  it("rejects a site the caller can't access before ever creating anything", async () => {
    const { service, tx } = makeService({ canAccessSite: jest.fn().mockResolvedValue(false) });
    await expect(
      service.createFromCustomer(customerDto, { actorId: clientViewer.id }, clientViewer),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.incident.create).not.toHaveBeenCalled();
  });

  it("posts `details` as a customer-visible (non-internal) first comment when provided", async () => {
    // The mocked tx.incident.create isn't visible to the separately-mocked
    // prisma.incident.findUnique that createComment's findOneScoped reads
    // back through — in real Postgres they're the same row (same
    // transaction), so this override just reflects that reality for the
    // mock: the incident createFromCustomer just made was reported by the
    // same customer now trying to comment on it.
    const { service, tx } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ reportedByUserId: clientViewer.id })),
    });
    await service.createFromCustomer(
      { ...customerDto, details: "Started around 2pm." },
      { actorId: clientViewer.id },
      clientViewer,
    );
    expect(tx.incidentComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body: "Started around 2pm.", isInternal: false }),
      }),
    );
  });

  it("creates no comment when `details` is omitted", async () => {
    const { service, tx } = makeService();
    await service.createFromCustomer(customerDto, { actorId: clientViewer.id }, clientViewer);
    expect(tx.incidentComment.create).not.toHaveBeenCalled();
  });
});

describe("IncidentsService.update", () => {
  it("calls SlaService.onPriorityChanged when priority actually changes", async () => {
    const { service, tx, slaService } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ siteId: "site-a", priority: Priority.P3 })),
    });
    await service.update("incident-1", { priority: Priority.P1 }, serviceDesk, {
      actorId: serviceDesk.id,
    });
    expect(slaService.onPriorityChanged).toHaveBeenCalledWith(
      tx,
      { id: "incident-1", siteId: "site-a" },
      Priority.P1,
      { actorId: serviceDesk.id },
    );
  });

  it("does not call onPriorityChanged when priority is left unchanged", async () => {
    const { service, slaService } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident({ priority: Priority.P3 })),
    });
    await service.update("incident-1", { shortDescription: "Updated text" }, engineer, {
      actorId: engineer.id,
    });
    expect(slaService.onPriorityChanged).not.toHaveBeenCalled();
  });

  it("notifies the newly assigned owner when a PATCH reassigns the ticket", async () => {
    const { service, notifications } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident({ ownerUserId: null })),
      userFindUnique: jest.fn().mockResolvedValue({
        id: "engineer-2",
        email: "engineer2@example.com",
        displayName: "Otis Engineer",
      }),
    });
    await service.update("incident-1", { ownerUserId: "engineer-2" }, serviceDesk, {
      actorId: serviceDesk.id,
    });
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ kind: "INCIDENT_ASSIGNED" }),
        recipients: { to: [{ name: "Otis Engineer", email: "engineer2@example.com" }] },
      }),
      "INCIDENT_ASSIGNED:incident-1:engineer-2",
    );
  });

  it("notifies every member of the group when a PATCH assigns it with no individual owner", async () => {
    const { service, notifications } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ ownerGroupId: null, ownerUserId: null })),
      supportGroupFindUnique: jest.fn().mockResolvedValue({
        id: "group-1",
        name: "Networking",
        members: [
          {
            user: {
              isActive: true,
              email: "eng1@example.com",
              displayName: "Eng One",
            },
          },
          {
            user: {
              isActive: true,
              email: "eng2@example.com",
              displayName: "Eng Two",
            },
          },
          // inactive members never get paged
          {
            user: { isActive: false, email: "gone@example.com", displayName: "Gone" },
          },
        ],
      }),
    });
    await service.update("incident-1", { ownerGroupId: "group-1" }, serviceDesk, {
      actorId: serviceDesk.id,
    });
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          kind: "INCIDENT_GROUP_ASSIGNED",
          group: { name: "Networking" },
        }),
        recipients: {
          to: [
            { name: "Eng One", email: "eng1@example.com" },
            { name: "Eng Two", email: "eng2@example.com" },
          ],
        },
      }),
      "INCIDENT_GROUP_ASSIGNED:incident-1:group-1",
    );
  });

  it("notifies the individual owner, not the group, when both are set in the same PATCH", async () => {
    const { service, notifications } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ ownerGroupId: null, ownerUserId: null })),
      userFindUnique: jest.fn().mockResolvedValue({
        id: "engineer-2",
        email: "engineer2@example.com",
        displayName: "Otis Engineer",
      }),
    });
    await service.update(
      "incident-1",
      { ownerGroupId: "group-1", ownerUserId: "engineer-2" },
      serviceDesk,
      { actorId: serviceDesk.id },
    );
    const kinds = (notifications.enqueue as jest.Mock).mock.calls.map(([job]) => job.event.kind);
    expect(kinds).toEqual(["INCIDENT_ASSIGNED"]);
  });

  it("does not notify when ownerUserId is left unchanged", async () => {
    const { service, notifications } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident({ ownerUserId: "engineer-1" })),
    });
    await service.update("incident-1", { shortDescription: "Updated text" }, engineer, {
      actorId: engineer.id,
    });
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });

  // Routing (ownership) and priority overrides are a Service Desk/elevated
  // call, not Site Engineer's (spec §4: Site Engineer's access is "limited
  // admin" scoped to diagnosis/restoration) — see INCIDENT_ROUTING_ROLES.
  it("forbids a Site Engineer from reassigning ownerUserId via PATCH", async () => {
    const { service, tx } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident()),
    });
    await expect(
      service.update("incident-1", { ownerUserId: "engineer-2" }, engineer, {
        actorId: engineer.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.incident.update).not.toHaveBeenCalled();
  });

  it("forbids a Site Engineer from reassigning ownerGroupId via PATCH", async () => {
    const { service, tx } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident()),
    });
    await expect(
      service.update("incident-1", { ownerGroupId: "group-1" }, engineer, {
        actorId: engineer.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.incident.update).not.toHaveBeenCalled();
  });

  it("forbids a Site Engineer from overriding priority via PATCH when it actually changes", async () => {
    const { service, tx } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident({ priority: Priority.P3 })),
    });
    await expect(
      service.update(
        "incident-1",
        { priority: Priority.P1, priorityChangeReason: "escalating" },
        engineer,
        { actorId: engineer.id },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.incident.update).not.toHaveBeenCalled();
  });

  it("still allows a Site Engineer to edit non-routing fields (diagnosis/description/CI)", async () => {
    const { service, tx } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident()),
    });
    await service.update(
      "incident-1",
      { shortDescription: "Confirmed PDU B fault", impact: "MEDIUM", ciId: "ci-1" },
      engineer,
      { actorId: engineer.id },
    );
    expect(tx.incident.update).toHaveBeenCalled();
  });

  it("does not forbid a Site Engineer whose PATCH round-trips the ticket's current owner/priority unchanged", async () => {
    // The edit form always resubmits the ticket's current owner/group/
    // priority in the body — this must stay a no-op for Site Engineer, not
    // a 403, or they couldn't edit anything else on a ticket they own.
    const { service, tx } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ ownerUserId: engineer.id, ownerGroupId: null, priority: Priority.P2 }),
        ),
    });
    await service.update(
      "incident-1",
      { shortDescription: "Still working it", ownerUserId: engineer.id, priority: Priority.P2 },
      engineer,
      { actorId: engineer.id },
    );
    expect(tx.incident.update).toHaveBeenCalled();
  });

  it("allows Service Desk/NOC to reassign ownership and override priority via PATCH", async () => {
    const { service, tx } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident({ priority: Priority.P3 })),
    });
    await service.update(
      "incident-1",
      { ownerUserId: "engineer-2", priority: Priority.P1, priorityChangeReason: "re-triaged" },
      serviceDesk,
      { actorId: serviceDesk.id },
    );
    expect(tx.incident.update).toHaveBeenCalled();
  });
});

describe("IncidentsService site-scope enforcement", () => {
  it("findOneScoped throws when the caller can't access the incident's site", async () => {
    const { service } = makeService({ canAccessSite: jest.fn().mockResolvedValue(false) });
    await expect(service.findOneScoped("incident-1", engineer)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("findOneScoped allows staff to see any incident at a site they can access, regardless of who reported it", async () => {
    const { service } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ reportedByUserId: "someone-else" })),
    });
    await expect(service.findOneScoped("incident-1", engineer)).resolves.toBeDefined();
  });

  it("findOneScoped allows a CLIENT_MANAGER_VIEWER to see an incident they reported", async () => {
    const { service } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ reportedByUserId: clientViewer.id })),
    });
    await expect(service.findOneScoped("incident-1", clientViewer)).resolves.toBeDefined();
  });

  it("findOneScoped throws for a CLIENT_MANAGER_VIEWER on an incident reported by someone else at the same site", async () => {
    const { service } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ reportedByUserId: "someone-else" })),
    });
    await expect(service.findOneScoped("incident-1", clientViewer)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("findOneScoped throws for a CLIENT_MANAGER_VIEWER on an incident nobody reported (staff-created)", async () => {
    const { service } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident({ reportedByUserId: null })),
    });
    await expect(service.findOneScoped("incident-1", clientViewer)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe("IncidentsService.findAll", () => {
  it("scopes to the caller's accessible sites when an explicit ?siteId isn't in scope", async () => {
    const { service, prisma } = makeService();
    await service.findAll(
      { siteId: "site-not-mine", limit: 50, offset: 0 },
      ["site-a", "site-b"],
      serviceDesk,
    );
    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ siteId: { in: ["site-a", "site-b"] } }),
      }),
    );
  });

  it("narrows to just the requested site when it IS in the caller's scope", async () => {
    const { service, prisma } = makeService();
    await service.findAll(
      { siteId: "site-a", limit: 50, offset: 0 },
      ["site-a", "site-b"],
      serviceDesk,
    );
    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ siteId: { in: ["site-a"] } }) }),
    );
  });

  it("applies no site filter for an unrestricted (null) caller", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ limit: 50, offset: 0 }, null, serviceDesk);
    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ siteId: undefined }) }),
    );
  });

  it("slaAtRisk=true filters to open incidents with a fired, non-breached milestone", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ slaAtRisk: true, limit: 50, offset: 0 }, null, serviceDesk);
    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: expect.arrayContaining(["NEW", "ASSIGNED"]) },
          slaInstances: { some: { breached: false, firedMilestones: { isEmpty: false } } },
        }),
      }),
    );
  });

  it("an explicit ?status still wins over slaAtRisk's implied open-status filter", async () => {
    const { service, prisma } = makeService();
    await service.findAll(
      { slaAtRisk: true, status: IncidentStatus.RESOLVED, limit: 50, offset: 0 },
      null,
      serviceDesk,
    );
    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: IncidentStatus.RESOLVED }),
      }),
    );
  });

  it("forces reportedByUserId to the caller's own id for CLIENT_MANAGER_VIEWER, ignoring site scope alone", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ limit: 50, offset: 0 }, ["site-a"], clientViewer);
    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ reportedByUserId: clientViewer.id }),
      }),
    );
  });

  it("never filters by reportedByUserId for staff roles", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ limit: 50, offset: 0 }, null, serviceDesk);
    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ reportedByUserId: undefined }),
      }),
    );
  });
});

describe("IncidentsService.countOpenOwnedBy", () => {
  it("counts only open incidents for the given owners", async () => {
    const incidentGroupBy = jest
      .fn()
      .mockResolvedValue([{ ownerUserId: "eng-1", _count: { _all: 2 } }]);
    const { service } = makeService({ incidentGroupBy });
    const counts = await service.countOpenOwnedBy(["eng-1", "eng-2"]);

    expect(counts.get("eng-1")).toBe(2);
    expect(counts.has("eng-2")).toBe(false);
    expect(incidentGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerUserId: { in: ["eng-1", "eng-2"] }, status: { in: OPEN_STATUSES } },
      }),
    );
  });

  it("skips the query entirely for an empty list", async () => {
    const incidentGroupBy = jest.fn();
    const { service } = makeService({ incidentGroupBy });
    expect((await service.countOpenOwnedBy([])).size).toBe(0);
    expect(incidentGroupBy).not.toHaveBeenCalled();
  });
});

describe("IncidentsService.createTransition", () => {
  it("rejects an invalid (from, to) pair", async () => {
    const { service } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident({ status: IncidentStatus.NEW })),
    });
    await expect(
      service.createTransition(
        "incident-1",
        { toStatus: IncidentStatus.RESOLVED },
        { actorId: "user-1" },
        serviceDesk,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects NEW -> ASSIGNED when no owner is resolved", async () => {
    const { service } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident({ status: IncidentStatus.NEW })),
    });
    await expect(
      service.createTransition(
        "incident-1",
        { toStatus: IncidentStatus.ASSIGNED },
        { actorId: "user-1" },
        serviceDesk,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a role that isn't allowed to perform the transition", async () => {
    const { service } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.ASSIGNED, ownerUserId: engineer.id }),
        ),
    });
    // CLIENT_MANAGER_VIEWER isn't in ASSIGNED -> ACKNOWLEDGED's allowedRoles.
    await expect(
      service.createTransition(
        "incident-1",
        { toStatus: IncidentStatus.ACKNOWLEDGED },
        { actorId: "user-1" },
        clientViewer,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects a non-owner, non-elevated engineer on an owner-restricted transition", async () => {
    const { service } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.ASSIGNED, ownerUserId: engineer.id }),
        ),
    });
    await expect(
      service.createTransition(
        "incident-1",
        { toStatus: IncidentStatus.ACKNOWLEDGED },
        { actorId: "user-1" },
        otherEngineer,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects RESOLVED without resolutionCategory/rootCauseSummary", async () => {
    const { service } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.IN_PROGRESS, ownerUserId: engineer.id }),
        ),
    });
    await expect(
      service.createTransition(
        "incident-1",
        { toStatus: IncidentStatus.RESOLVED },
        { actorId: "user-1" },
        engineer,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("performs a valid transition, sets acknowledgedAt, and writes both the timeline event and the audit record", async () => {
    const { service, tx, auditService } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.ASSIGNED, ownerUserId: engineer.id }),
        ),
    });

    const result = await service.createTransition(
      "incident-1",
      { toStatus: IncidentStatus.ACKNOWLEDGED },
      { actorId: engineer.id },
      engineer,
    );

    expect(result).toMatchObject({ status: IncidentStatus.ACKNOWLEDGED });
    expect(result.acknowledgedAt).toBeInstanceOf(Date);
    expect(tx.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: "STATUS_CHANGE" }) }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "Incident", action: "TRANSITION" }),
      tx,
    );
  });

  it("calls SlaService.onAcknowledged when transitioning to ACKNOWLEDGED", async () => {
    const { service, tx, slaService } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.ASSIGNED, ownerUserId: engineer.id }),
        ),
    });
    const result = await service.createTransition(
      "incident-1",
      { toStatus: IncidentStatus.ACKNOWLEDGED },
      { actorId: engineer.id },
      engineer,
    );
    expect(slaService.onAcknowledged).toHaveBeenCalledWith(
      tx,
      "incident-1",
      result.acknowledgedAt,
      { actorId: engineer.id },
    );
  });

  it("calls SlaService.onResolved when transitioning to RESOLVED", async () => {
    const { service, tx, slaService } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.IN_PROGRESS, ownerUserId: engineer.id }),
        ),
    });
    const result = await service.createTransition(
      "incident-1",
      {
        toStatus: IncidentStatus.RESOLVED,
        resolutionCategory: "HARDWARE_REPLACED",
        rootCauseSummary: "Faulty PSU replaced",
      },
      { actorId: engineer.id },
      engineer,
    );
    expect(slaService.onResolved).toHaveBeenCalledWith(tx, "incident-1", result.restoredAt, {
      actorId: engineer.id,
    });
  });

  it("blocks RESOLVED when a linked alert is still OPEN and no reason is given", async () => {
    const { service } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.IN_PROGRESS, ownerUserId: engineer.id }),
        ),
      alertFindMany: jest
        .fn()
        .mockResolvedValue([
          {
            id: "alert-1",
            alertType: "hardware.health_degraded",
            severity: "CRITICAL",
            state: "OPEN",
          },
        ]),
    });
    await expect(
      service.createTransition(
        "incident-1",
        {
          toStatus: IncidentStatus.RESOLVED,
          resolutionCategory: "HARDWARE_REPLACED",
          rootCauseSummary: "Faulty PSU replaced",
        },
        { actorId: engineer.id },
        engineer,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("allows RESOLVED with an open linked alert when a reason overrides it, and records the override on the timeline", async () => {
    const { service, tx } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.IN_PROGRESS, ownerUserId: engineer.id }),
        ),
      alertFindMany: jest
        .fn()
        .mockResolvedValue([
          {
            id: "alert-1",
            alertType: "hardware.health_degraded",
            severity: "CRITICAL",
            state: "OPEN",
          },
        ]),
    });
    const result = await service.createTransition(
      "incident-1",
      {
        toStatus: IncidentStatus.RESOLVED,
        resolutionCategory: "HARDWARE_REPLACED",
        rootCauseSummary: "Faulty PSU replaced",
        reason: "Redundant PSU covers load; vendor RMA already in flight",
      },
      { actorId: engineer.id },
      engineer,
    );
    expect(result).toMatchObject({ status: IncidentStatus.RESOLVED });
    expect(tx.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "STATUS_CHANGE",
          payload: expect.objectContaining({
            resolvedWithOpenAlerts: [
              expect.objectContaining({ id: "alert-1", severity: "CRITICAL", state: "OPEN" }),
            ],
          }),
        }),
      }),
    );
  });

  it("allows RESOLVED without a reason when no linked alert is still open", async () => {
    const { service } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.IN_PROGRESS, ownerUserId: engineer.id }),
        ),
      alertFindMany: jest.fn().mockResolvedValue([]),
    });
    const result = await service.createTransition(
      "incident-1",
      {
        toStatus: IncidentStatus.RESOLVED,
        resolutionCategory: "HARDWARE_REPLACED",
        rootCauseSummary: "Faulty PSU replaced",
      },
      { actorId: engineer.id },
      engineer,
    );
    expect(result).toMatchObject({ status: IncidentStatus.RESOLVED });
  });

  it("calls SlaService.onPaused when transitioning to PENDING_VENDOR", async () => {
    const { service, tx, slaService } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.IN_PROGRESS, ownerUserId: engineer.id }),
        ),
    });
    await service.createTransition(
      "incident-1",
      { toStatus: IncidentStatus.PENDING_VENDOR, reason: "Awaiting vendor dispatch" },
      { actorId: engineer.id },
      engineer,
    );
    expect(slaService.onPaused).toHaveBeenCalledWith(tx, "incident-1", "PENDING_VENDOR", {
      actorId: engineer.id,
    });
  });

  it("calls SlaService.onResumed when returning to IN_PROGRESS from a paused state", async () => {
    const { service, tx, slaService } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.PENDING_CUSTOMER, ownerUserId: engineer.id }),
        ),
    });
    await service.createTransition(
      "incident-1",
      { toStatus: IncidentStatus.IN_PROGRESS },
      { actorId: engineer.id },
      engineer,
    );
    expect(slaService.onResumed).toHaveBeenCalledWith(tx, "incident-1", { actorId: engineer.id });
  });

  it("does NOT call onResumed for ACKNOWLEDGED -> IN_PROGRESS (no pause to resume)", async () => {
    const { service, slaService } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.ACKNOWLEDGED, ownerUserId: engineer.id }),
        ),
    });
    await service.createTransition(
      "incident-1",
      { toStatus: IncidentStatus.IN_PROGRESS },
      { actorId: engineer.id },
      engineer,
    );
    expect(slaService.onResumed).not.toHaveBeenCalled();
  });

  it("calls SlaService.onReopened when transitioning to REOPENED", async () => {
    const { service, tx, slaService } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.RESOLVED, ownerUserId: engineer.id }),
        ),
    });
    await service.createTransition(
      "incident-1",
      { toStatus: IncidentStatus.REOPENED, reason: "Issue recurred" },
      { actorId: engineer.id },
      serviceDesk,
    );
    expect(slaService.onReopened).toHaveBeenCalledWith(tx, "incident-1", {
      actorId: engineer.id,
    });
  });

  it("notifies the newly assigned owner when NEW -> ASSIGNED resolves one in the same request", async () => {
    const { service, notifications } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident({ status: IncidentStatus.NEW })),
      userFindUnique: jest.fn().mockResolvedValue({
        id: "engineer-1",
        email: "engineer@example.com",
        displayName: "Engineer One",
      }),
    });
    await service.createTransition(
      "incident-1",
      { toStatus: IncidentStatus.ASSIGNED, ownerUserId: "engineer-1" },
      { actorId: serviceDesk.id },
      serviceDesk,
    );
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ kind: "INCIDENT_ASSIGNED" }) }),
      "INCIDENT_ASSIGNED:incident-1:engineer-1",
    );
  });

  it("notifies the group when NEW -> ASSIGNED resolves one with no individual owner", async () => {
    const { service, notifications } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident({ status: IncidentStatus.NEW })),
      supportGroupFindUnique: jest.fn().mockResolvedValue({
        id: "group-1",
        name: "Networking",
        members: [{ user: { isActive: true, email: "eng1@example.com", displayName: "Eng One" } }],
      }),
    });
    await service.createTransition(
      "incident-1",
      { toStatus: IncidentStatus.ASSIGNED, ownerGroupId: "group-1" },
      { actorId: serviceDesk.id },
      serviceDesk,
    );
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ kind: "INCIDENT_GROUP_ASSIGNED" }),
        recipients: { to: [{ name: "Eng One", email: "eng1@example.com" }] },
      }),
      "INCIDENT_GROUP_ASSIGNED:incident-1:group-1",
    );
  });

  it("notifies owner (to) and cc's the reporting customer on every status change", async () => {
    const { service, notifications } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(
        baseIncident({
          status: IncidentStatus.ACKNOWLEDGED,
          ownerUserId: engineer.id,
          reportedByUserId: "customer-1",
        }),
      ),
      // The shared txIncident.update mock spreads a *fresh* baseIncident()
      // under the data patch, so it wouldn't otherwise carry the owner/
      // reportedBy fields set on the pre-transition incident through to
      // `after` — override it here so `after` reflects them like the real
      // Prisma update (which only changes the fields `data` names) would.
      txIncident: {
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...baseIncident({ ownerUserId: engineer.id, reportedByUserId: "customer-1" }),
            ...data,
          }),
        ),
      },
      userFindMany: jest.fn().mockResolvedValue([
        { id: engineer.id, email: "engineer@example.com", displayName: "Engineer One" },
        { id: "customer-1", email: "customer@example.com", displayName: "Site POC" },
      ]),
    });
    await service.createTransition(
      "incident-1",
      { toStatus: IncidentStatus.IN_PROGRESS },
      { actorId: engineer.id },
      engineer,
    );
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          kind: "INCIDENT_STATUS_CHANGED",
          from: IncidentStatus.ACKNOWLEDGED,
          to: IncidentStatus.IN_PROGRESS,
        }),
        recipients: {
          to: [{ name: "Engineer One", email: "engineer@example.com" }],
          cc: [{ name: "Site POC", email: "customer@example.com" }],
        },
      }),
    );
  });

  it("skips the status-change notification when the owner lookup comes back with no email", async () => {
    const { service, notifications } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.RESOLVED, ownerUserId: engineer.id }),
        ),
      txIncident: {
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...baseIncident({ ownerUserId: engineer.id }), ...data }),
          ),
      },
      // Owner id is on the incident, but the lookup finds no matching row
      // (e.g. deactivated/deleted user) — partyFor() has nothing to build a
      // Party from, so there's no recipient at all.
      userFindMany: jest.fn().mockResolvedValue([]),
    });
    await service.createTransition(
      "incident-1",
      { toStatus: IncidentStatus.CLOSED },
      { actorId: serviceDesk.id },
      serviceDesk,
    );
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });
});

describe("IncidentsService.getAvailableTransitions", () => {
  it("omits a transition the caller's role can never perform", async () => {
    const { service } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.NEW, reportedByUserId: clientViewer.id }),
        ),
    });
    // NEW -> ASSIGNED's allowedRoles doesn't include CLIENT_MANAGER_VIEWER.
    const result = await service.getAvailableTransitions("incident-1", clientViewer);
    expect(result).toEqual([]);
  });

  it("marks a role-eligible transition blocked when the owner-or-elevated gate fails", async () => {
    const { service } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.PENDING_CUSTOMER, ownerUserId: otherEngineer.id }),
        ),
    });
    // serviceDesk's role is allowed for PENDING_CUSTOMER -> IN_PROGRESS, but
    // they're neither the owner (otherEngineer is) nor elevated.
    const result = await service.getAvailableTransitions("incident-1", serviceDesk);
    expect(result).toEqual([
      {
        toStatus: IncidentStatus.IN_PROGRESS,
        requiredFields: [],
        allowed: false,
        blockedReason: expect.stringContaining("owner"),
      },
    ]);
  });

  it("returns allowed: true with no blockedReason when every gate passes", async () => {
    const { service } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ status: IncidentStatus.IN_PROGRESS })),
    });
    // IN_PROGRESS -> PENDING_CUSTOMER has no requiresOwnerOrElevated gate.
    const result = await service.getAvailableTransitions("incident-1", serviceDesk);
    expect(result).toEqual([
      {
        toStatus: IncidentStatus.PENDING_CUSTOMER,
        requiredFields: ["reason"],
        allowed: true,
        blockedReason: undefined,
      },
    ]);
  });

  it("surfaces a hint from the rule's validate() when it's neither a requiredFields entry nor an ownership block", async () => {
    const { service } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident({ status: IncidentStatus.NEW })),
    });
    // NEW -> ASSIGNED has no requiresOwnerOrElevated gate and no
    // requiredFields entry for it, but its validate() still needs an owner
    // resolved — that's what `hint` is for.
    const result = await service.getAvailableTransitions("incident-1", serviceDesk);
    expect(result).toEqual([
      {
        toStatus: IncidentStatus.ASSIGNED,
        requiredFields: [],
        allowed: true,
        blockedReason: undefined,
        hint: expect.stringContaining("resolved"),
      },
    ]);
  });

  it("omits the hint once the incident already satisfies the rule's validate()", async () => {
    const { service } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ status: IncidentStatus.NEW, ownerUserId: "engineer-1" })),
    });
    const result = await service.getAvailableTransitions("incident-1", serviceDesk);
    expect(result).toEqual([
      {
        toStatus: IncidentStatus.ASSIGNED,
        requiredFields: [],
        allowed: true,
        blockedReason: undefined,
        hint: undefined,
      },
    ]);
  });

  it("hints that a RESOLVED move needs a reason while a linked alert is still OPEN", async () => {
    const { service } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.IN_PROGRESS, ownerUserId: engineer.id }),
        ),
      alertFindMany: jest
        .fn()
        .mockResolvedValue([
          {
            id: "alert-1",
            alertType: "hardware.health_degraded",
            severity: "CRITICAL",
            state: "OPEN",
          },
        ]),
    });
    const result = await service.getAvailableTransitions("incident-1", engineer);
    const resolved = result.find((r) => r.toStatus === IncidentStatus.RESOLVED);
    expect(resolved?.allowed).toBe(true);
    expect(resolved?.hint).toMatch(/still OPEN/);
    expect(resolved?.hint).toMatch(/hardware.health_degraded/);
  });

  it("lists every candidate when multiple rules share the same (from, role)", async () => {
    const { service } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ status: IncidentStatus.RESOLVED })),
    });
    // RESOLVED -> CLOSED and RESOLVED -> REOPENED both allow SERVICE_DESK_NOC.
    const result = await service.getAvailableTransitions("incident-1", serviceDesk);
    expect(result.map((r) => r.toStatus).sort()).toEqual(
      [IncidentStatus.CLOSED, IncidentStatus.REOPENED].sort(),
    );
  });
});

describe("IncidentsService comment visibility", () => {
  it("excludes internal comments for CLIENT_MANAGER_VIEWER", async () => {
    const comments = [
      { id: "c1", incidentId: "incident-1", isInternal: true, body: "internal note" },
      { id: "c2", incidentId: "incident-1", isInternal: false, body: "customer-visible" },
    ];
    const { service, prisma } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ reportedByUserId: clientViewer.id })),
    });
    (prisma.incidentComment.findMany as jest.Mock).mockResolvedValue(comments);

    const result = await service.listComments("incident-1", clientViewer);
    expect(result).toEqual([comments[1]]);
  });

  it("returns every comment for a non-viewer role", async () => {
    const comments = [
      { id: "c1", incidentId: "incident-1", isInternal: true, body: "internal note" },
      { id: "c2", incidentId: "incident-1", isInternal: false, body: "customer-visible" },
    ];
    const { service, prisma } = makeService();
    (prisma.incidentComment.findMany as jest.Mock).mockResolvedValue(comments);

    const result = await service.listComments("incident-1", engineer);
    expect(result).toEqual(comments);
  });
});

describe("IncidentsService.createComment isInternal enforcement", () => {
  it("forces isInternal false for CLIENT_MANAGER_VIEWER even if the request asked for true", async () => {
    const { service, tx } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ reportedByUserId: clientViewer.id })),
    });
    await service.createComment(
      "incident-1",
      { body: "Any update?", isInternal: true },
      { actorId: clientViewer.id },
      clientViewer,
    );
    expect(tx.incidentComment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isInternal: false }) }),
    );
  });

  it("still defaults to internal (true) for an internal role when omitted", async () => {
    const { service, tx } = makeService();
    await service.createComment("incident-1", { body: "note" }, { actorId: engineer.id }, engineer);
    expect(tx.incidentComment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isInternal: true }) }),
    );
  });
});

describe("IncidentsService.createComment notifications", () => {
  it("notifies the assigned owner when the customer comments", async () => {
    const { service, notifications } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ ownerUserId: engineer.id, reportedByUserId: clientViewer.id }),
        ),
      userFindUnique: jest.fn().mockResolvedValue({
        id: engineer.id,
        email: "engineer@example.com",
        displayName: "Engineer One",
      }),
    });
    await service.createComment(
      "incident-1",
      { body: "Any update?" },
      { actorId: clientViewer.id },
      clientViewer,
    );
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ kind: "INCIDENT_COMMENT_ADDED", body: "Any update?" }),
        recipients: { to: [{ name: "Engineer One", email: "engineer@example.com" }] },
      }),
    );
  });

  it("skips the customer notification when the ticket has no owner yet", async () => {
    const { service, notifications } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ ownerUserId: null, reportedByUserId: clientViewer.id })),
    });
    await service.createComment(
      "incident-1",
      { body: "Any update?" },
      { actorId: clientViewer.id },
      clientViewer,
    );
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });

  it("notifies the reporting customer when staff posts a customer-visible reply", async () => {
    const { service, notifications } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ reportedByUserId: "customer-1" })),
      userFindUnique: jest.fn().mockResolvedValue({
        id: "customer-1",
        email: "customer@example.com",
        displayName: "Site POC",
      }),
    });
    await service.createComment(
      "incident-1",
      { body: "Confirming the asset tag now.", isInternal: false },
      { actorId: engineer.id },
      engineer,
    );
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ kind: "INCIDENT_COMMENT_ADDED" }),
        recipients: { to: [{ name: "Site POC", email: "customer@example.com" }] },
      }),
    );
  });

  it("does not notify anyone for an internal-only note between staff", async () => {
    const { service, notifications } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ reportedByUserId: "customer-1" })),
    });
    await service.createComment(
      "incident-1",
      { body: "Checking the vendor portal.", isInternal: true },
      { actorId: engineer.id },
      engineer,
    );
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });
});

describe("IncidentsService attachments", () => {
  const validFile = {
    originalname: "log.txt",
    mimetype: "text/plain",
    size: 1024,
    buffer: Buffer.from("hello"),
  };

  it("rejects a disallowed content type before touching storage", async () => {
    const { service, storageService } = makeService();
    await expect(
      service.uploadAttachment(
        "incident-1",
        { ...validFile, mimetype: "application/x-msdownload" },
        { actorId: "user-1" },
        engineer,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storageService.putObject).not.toHaveBeenCalled();
  });

  it("rejects a file over the size ceiling before touching storage", async () => {
    const { service, storageService } = makeService();
    await expect(
      service.uploadAttachment(
        "incident-1",
        { ...validFile, size: 999_999_999 },
        { actorId: "user-1" },
        engineer,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storageService.putObject).not.toHaveBeenCalled();
  });

  it("uploads to storage, records the Attachment row, and writes both the timeline event and the audit record", async () => {
    const { service, tx, storageService, auditService } = makeService();
    const result = await service.uploadAttachment(
      "incident-1",
      validFile,
      { actorId: "user-1" },
      engineer,
    );

    expect(result).toMatchObject({ entityType: "INCIDENT", entityId: "incident-1" });
    expect(storageService.putObject).toHaveBeenCalledTimes(1);
    expect(tx.attachment.create).toHaveBeenCalledTimes(1);
    expect(tx.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: "ATTACHMENT" }) }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "Attachment", action: "CREATE" }),
      tx,
    );
  });

  it("404s a download-url request for an attachment that doesn't belong to this incident", async () => {
    const { service } = makeService();
    await expect(
      service.getAttachmentDownloadUrl("incident-1", "missing-attachment", engineer),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns a signed URL for a valid attachment", async () => {
    const { service, prisma } = makeService();
    (prisma.attachment.findUnique as jest.Mock).mockResolvedValue({
      id: "attachment-1",
      entityType: "INCIDENT",
      entityId: "incident-1",
      objectKey: "incidents/incident-1/foo.txt",
      deletedAt: null,
    });

    const result = await service.getAttachmentDownloadUrl("incident-1", "attachment-1", engineer);
    expect(result).toEqual({ url: "https://signed.example/download" });
  });

  it("deleteAttachment soft-deletes, writes the timeline event + audit record, and never touches storage", async () => {
    const { service, prisma, tx, auditService, storageService } = makeService();
    (prisma.attachment.findUnique as jest.Mock).mockResolvedValue({
      id: "attachment-1",
      entityType: "INCIDENT",
      entityId: "incident-1",
      objectKey: "incidents/incident-1/foo.txt",
      contentType: "text/plain",
      deletedAt: null,
    });

    await service.deleteAttachment("incident-1", "attachment-1", { actorId: "user-1" }, engineer);

    expect(tx.attachment.update).toHaveBeenCalledWith({
      where: { id: "attachment-1" },
      data: { deletedAt: expect.any(Date), deletedById: "user-1" },
    });
    expect(tx.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: "incident-1",
          eventType: "ATTACHMENT_REMOVED",
        }),
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "Attachment",
        entityId: "attachment-1",
        action: "DELETE",
      }),
      tx,
    );
    expect(storageService.putObject).not.toHaveBeenCalled();
  });

  it("deleteAttachment 404s an already-deleted attachment (can't remove it twice)", async () => {
    const { service, prisma } = makeService();
    (prisma.attachment.findUnique as jest.Mock).mockResolvedValue({
      id: "attachment-1",
      entityType: "INCIDENT",
      entityId: "incident-1",
      objectKey: "incidents/incident-1/foo.txt",
      deletedAt: new Date("2026-09-01T00:00:00Z"),
    });

    await expect(
      service.deleteAttachment("incident-1", "attachment-1", { actorId: "user-1" }, engineer),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("getAttachmentDownloadUrl 404s a soft-deleted attachment", async () => {
    const { service, prisma } = makeService();
    (prisma.attachment.findUnique as jest.Mock).mockResolvedValue({
      id: "attachment-1",
      entityType: "INCIDENT",
      entityId: "incident-1",
      objectKey: "incidents/incident-1/foo.txt",
      deletedAt: new Date("2026-09-01T00:00:00Z"),
    });

    await expect(
      service.getAttachmentDownloadUrl("incident-1", "attachment-1", engineer),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("listAttachments excludes soft-deleted rows", async () => {
    const { service, prisma } = makeService();
    await service.listAttachments("incident-1", engineer);

    expect(prisma.attachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityType: "INCIDENT", entityId: "incident-1", deletedAt: null },
      }),
    );
  });
});

describe("IncidentsService alert correlation", () => {
  const alertRef = {
    id: "alert-9",
    alertType: "disk.predictive_failure",
    severity: "HIGH",
    source: "ZABBIX",
    fingerprint: "f".repeat(64),
  };

  it("findOpenByCi queries only still-open statuses, newest first", async () => {
    const { service, prisma } = makeService();
    (prisma.incident.findFirst as jest.Mock).mockResolvedValue(baseIncident({ id: "inc-open" }));

    const result = await service.findOpenByCi("ci-1");

    expect(result).toMatchObject({ id: "inc-open" });
    const arg = (prisma.incident.findFirst as jest.Mock).mock.calls[0][0];
    expect(arg.where.ciId).toBe("ci-1");
    expect(arg.where.status.in).toEqual(
      expect.arrayContaining([
        IncidentStatus.NEW,
        IncidentStatus.IN_PROGRESS,
        IncidentStatus.REOPENED,
      ]),
    );
    expect(arg.where.status.in).not.toContain(IncidentStatus.RESOLVED);
    expect(arg.where.status.in).not.toContain(IncidentStatus.CLOSED);
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("findOpenByCi returns null when the CI has no open incident", async () => {
    const { service } = makeService();
    await expect(service.findOpenByCi("ci-1")).resolves.toBeNull();
  });

  it("linkAlert appends an ALERT_LINKED event + audit in one transaction", async () => {
    const { service, tx, auditService } = makeService();

    const result = await service.linkAlert("incident-1", alertRef, { actorId: "collector-svc" });

    expect(result).toEqual({ linked: true });
    expect(tx.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: "incident-1",
          eventType: "ALERT_LINKED",
          payload: expect.objectContaining({ alertId: "alert-9", source: "ZABBIX" }),
        }),
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "Incident", action: "ALERT_LINKED" }),
      tx,
    );
  });

  it("linkAlert is idempotent — a repeat for the same alert is a no-op", async () => {
    const { service, prisma, tx } = makeService();
    (prisma.incidentEvent.findFirst as jest.Mock).mockResolvedValue({ id: "existing-event" });

    const result = await service.linkAlert("incident-1", alertRef, { actorId: "collector-svc" });

    expect(result).toEqual({ linked: false });
    expect(tx.incidentEvent.create).not.toHaveBeenCalled();
  });

  it("linkAlert 404s an unknown incident", async () => {
    const { service } = makeService({ incidentFindUnique: jest.fn().mockResolvedValue(null) });
    await expect(
      service.linkAlert("missing", alertRef, { actorId: "collector-svc" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("IncidentsService.notifyAlertRecovered", () => {
  const recoveredAlert = {
    id: "alert-9",
    alertType: "hardware.health_degraded",
    severity: "CRITICAL",
    source: "REDFISH",
  };

  it("no-ops when the incident is still open — the expected order needs no extra signal", async () => {
    const { service, tx, auditService, notifications } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ status: IncidentStatus.IN_PROGRESS })),
    });

    const result = await service.notifyAlertRecovered("incident-1", recoveredAlert, {
      actorId: "collector-svc",
    });

    expect(result).toEqual({ notified: false });
    expect(tx.incidentEvent.create).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });

  it("no-ops when the incident is unknown", async () => {
    const { service, tx } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(null),
    });
    const result = await service.notifyAlertRecovered("missing", recoveredAlert, {
      actorId: "collector-svc",
    });
    expect(result).toEqual({ notified: false });
    expect(tx.incidentEvent.create).not.toHaveBeenCalled();
  });

  it("writes the timeline event + audit record and emails the owner when RESOLVED", async () => {
    const { service, tx, auditService, notifications } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ status: IncidentStatus.RESOLVED, ownerUserId: engineer.id }),
        ),
      userFindUnique: jest.fn().mockResolvedValue({
        id: engineer.id,
        email: "engineer@example.com",
        displayName: "Engineer One",
      }),
    });

    const result = await service.notifyAlertRecovered("incident-1", recoveredAlert, {
      actorId: "collector-svc",
    });

    expect(result).toEqual({ notified: true });
    expect(tx.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: "incident-1",
          eventType: "ALERT_RECOVERED_AFTER_RESOLVE",
          payload: expect.objectContaining({
            alertId: "alert-9",
            severity: "CRITICAL",
            incidentStatusAtRecovery: IncidentStatus.RESOLVED,
          }),
        }),
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "Incident", action: "ALERT_RECOVERED_AFTER_RESOLVE" }),
      tx,
    );
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          kind: "INCIDENT_ALERT_RECOVERED_AFTER_RESOLVE",
          alertType: "hardware.health_degraded",
        }),
        recipients: { to: [{ name: "Engineer One", email: "engineer@example.com" }] },
      }),
      expect.any(String),
    );
  });

  it("also notifies when the incident is CLOSED, not just RESOLVED", async () => {
    const { service, tx } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ status: IncidentStatus.CLOSED })),
    });
    const result = await service.notifyAlertRecovered("incident-1", recoveredAlert, {
      actorId: "collector-svc",
    });
    expect(result).toEqual({ notified: true });
    expect(tx.incidentEvent.create).toHaveBeenCalled();
  });

  it("still writes the timeline/audit record when the ticket has no owner to email", async () => {
    const { service, tx, notifications } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ status: IncidentStatus.RESOLVED, ownerUserId: null })),
    });
    const result = await service.notifyAlertRecovered("incident-1", recoveredAlert, {
      actorId: "collector-svc",
    });
    expect(result).toEqual({ notified: true });
    expect(tx.incidentEvent.create).toHaveBeenCalled();
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });
});

describe("IncidentsService incident.created event", () => {
  it("emits incident.created after the create commits", async () => {
    const { service, events } = makeService();
    const result = await service.create(baseCreateDto, {
      actorId: "user-1",
      correlationId: "corr-1",
    });

    expect(events.emit).toHaveBeenCalledWith("incident.created", {
      incidentId: result.id,
      siteId: result.siteId,
      correlationId: "corr-1",
    });
  });
});

describe("IncidentsService.autoAssign", () => {
  it("moves a NEW unowned incident to ASSIGNED as a system action", async () => {
    const { service, tx, auditService, notifications } = makeService({
      userFindUnique: jest
        .fn()
        .mockResolvedValue({ id: "eng-1", displayName: "Eng", email: "eng@corp.example" }),
    });
    const result = await service.autoAssign("incident-1", "eng-1", "corr-1");

    expect(result).toMatchObject({ status: IncidentStatus.ASSIGNED, ownerUserId: "eng-1" });
    expect(tx.incident.updateMany).toHaveBeenCalledWith({
      where: {
        id: "incident-1",
        status: IncidentStatus.NEW,
        ownerUserId: null,
        ownerGroupId: null,
      },
      data: { status: IncidentStatus.ASSIGNED, ownerUserId: "eng-1" },
    });
    expect(tx.incidentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "STATUS_CHANGE",
          actorId: null,
          payload: expect.objectContaining({ source: "SKILL_ROUTING", to: "ASSIGNED" }),
        }),
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "TRANSITION", actorId: null, correlationId: "corr-1" }),
      tx,
    );
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ kind: "INCIDENT_ASSIGNED" }),
      }),
      "INCIDENT_ASSIGNED:incident-1:eng-1",
    );
  });

  it("does nothing when the incident is no longer NEW", async () => {
    const { service, tx } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ status: IncidentStatus.ASSIGNED })),
    });
    await expect(service.autoAssign("incident-1", "eng-1")).resolves.toBeNull();
    expect(tx.incident.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing when someone already owns it", async () => {
    const { service, tx } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident({ ownerGroupId: "group-1" })),
    });
    await expect(service.autoAssign("incident-1", "eng-1")).resolves.toBeNull();
    expect(tx.incident.updateMany).not.toHaveBeenCalled();
  });

  it("backs off without side effects when the desk assigned it concurrently", async () => {
    const { service, tx, auditService } = makeService({
      txUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });
    await expect(service.autoAssign("incident-1", "eng-1")).resolves.toBeNull();
    expect(tx.incidentEvent.create).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });
});

describe("IncidentsService in-app notifications", () => {
  it("puts a new ticket in every service desk user's bell, except whoever raised it", async () => {
    const { service, inbox } = makeService({
      userFindMany: jest.fn().mockResolvedValue([
        { id: "desk-1", email: "desk1@corp.example", displayName: "Desk One" },
        { id: "desk-2", email: "desk2@corp.example", displayName: "Desk Two" },
      ]),
    });

    const result = await service.create(baseCreateDto, { actorId: "desk-1" });

    expect(inbox.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "INCIDENT_CREATED",
        userIds: ["desk-1", "desk-2"],
        actorUserId: "desk-1",
        entityType: "INCIDENT",
        entityId: result.id,
        dedupeKey: `created:${result.id}`,
      }),
    );
  });

  it("tells the new owner in-app when a PATCH reassigns the ticket", async () => {
    const { service, inbox } = makeService({
      incidentFindUnique: jest.fn().mockResolvedValue(baseIncident({ ownerUserId: null })),
      userFindUnique: jest.fn().mockResolvedValue({
        id: "engineer-2",
        email: "engineer2@example.com",
        displayName: "Otis Engineer",
      }),
    });

    await service.update("incident-1", { ownerUserId: "engineer-2" }, serviceDesk, {
      actorId: serviceDesk.id,
    });

    expect(inbox.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "INCIDENT_ASSIGNED",
        userIds: ["engineer-2"],
        actorUserId: serviceDesk.id,
        title: "INC-000001 assigned to you",
      }),
    );
  });

  it("tells the owner in-app when the customer comments, never the author", async () => {
    const { service, inbox } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(
          baseIncident({ ownerUserId: engineer.id, reportedByUserId: clientViewer.id }),
        ),
      userFindUnique: jest.fn().mockResolvedValue({
        id: engineer.id,
        email: "engineer@example.com",
        displayName: "Engineer One",
      }),
    });

    await service.createComment(
      "incident-1",
      { body: "Any update?" },
      { actorId: clientViewer.id },
      clientViewer,
    );

    expect(inbox.notifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "INCIDENT_COMMENT_ADDED",
        userIds: [engineer.id],
        actorUserId: clientViewer.id,
        body: "Any update?",
        dedupeKey: expect.stringMatching(/^comment:/),
      }),
    );
  });

  it("writes nothing in-app for an internal-only staff note", async () => {
    const { service, inbox } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ reportedByUserId: "customer-1" })),
    });

    await service.createComment(
      "incident-1",
      { body: "Checking the vendor portal.", isInternal: true },
      { actorId: engineer.id },
      engineer,
    );

    expect(inbox.notifyUsers).not.toHaveBeenCalled();
  });

  it("auto-assign sends the assignment and status change in-app with no human actor", async () => {
    const { service, inbox } = makeService();

    await service.autoAssign("incident-1", "eng-1");

    const calls = (inbox.notifyUsers as jest.Mock).mock.calls.map(([input]) => input);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "INCIDENT_STATUS_CHANGED",
          userIds: ["eng-1"],
          actorUserId: undefined,
          title: "INC-000001: NEW → ASSIGNED",
        }),
        expect.objectContaining({
          kind: "INCIDENT_ASSIGNED",
          userIds: ["eng-1"],
          actorUserId: undefined,
        }),
      ]),
    );
  });
});
