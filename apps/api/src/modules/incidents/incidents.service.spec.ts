import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { IncidentStatus, Priority, UserRole } from "@prisma/client";
import { StorageService } from "../../common/storage/storage.service";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthzService } from "../auth/authz.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { SlaService } from "../sla/sla.service";
import { IncidentsService } from "./incidents.service";

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

const ctsViewer: AuthenticatedUser = {
  id: "viewer-1",
  email: "viewer@example.com",
  role: UserRole.CTS_MANAGER_VIEWER,
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
  } = {},
) {
  const txIncident = {
    create: jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ ...baseIncident(), ...data })),
    update: jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ ...baseIncident(), ...data })),
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

  return {
    service: new IncidentsService(prisma, auditService, authzService, storageService, slaService),
    prisma,
    auditService,
    authzService,
    storageService,
    slaService,
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

describe("IncidentsService.update", () => {
  it("calls SlaService.onPriorityChanged when priority actually changes", async () => {
    const { service, tx, slaService } = makeService({
      incidentFindUnique: jest
        .fn()
        .mockResolvedValue(baseIncident({ siteId: "site-a", priority: Priority.P3 })),
    });
    await service.update("incident-1", { priority: Priority.P1 }, engineer, {
      actorId: engineer.id,
    });
    expect(slaService.onPriorityChanged).toHaveBeenCalledWith(
      tx,
      { id: "incident-1", siteId: "site-a" },
      Priority.P1,
      { actorId: engineer.id },
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
});

describe("IncidentsService site-scope enforcement", () => {
  it("findOneScoped throws when the caller can't access the incident's site", async () => {
    const { service } = makeService({ canAccessSite: jest.fn().mockResolvedValue(false) });
    await expect(service.findOneScoped("incident-1", engineer)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe("IncidentsService.findAll", () => {
  it("scopes to the caller's accessible sites when an explicit ?siteId isn't in scope", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ siteId: "site-not-mine", limit: 50, offset: 0 }, ["site-a", "site-b"]);
    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ siteId: { in: ["site-a", "site-b"] } }),
      }),
    );
  });

  it("narrows to just the requested site when it IS in the caller's scope", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ siteId: "site-a", limit: 50, offset: 0 }, ["site-a", "site-b"]);
    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ siteId: { in: ["site-a"] } }) }),
    );
  });

  it("applies no site filter for an unrestricted (null) caller", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ limit: 50, offset: 0 }, null);
    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ siteId: undefined }) }),
    );
  });

  it("slaAtRisk=true filters to open incidents with a fired, non-breached milestone", async () => {
    const { service, prisma } = makeService();
    await service.findAll({ slaAtRisk: true, limit: 50, offset: 0 }, null);
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
    );
    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: IncidentStatus.RESOLVED }),
      }),
    );
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
    // CTS_MANAGER_VIEWER isn't in ASSIGNED -> ACKNOWLEDGED's allowedRoles.
    await expect(
      service.createTransition(
        "incident-1",
        { toStatus: IncidentStatus.ACKNOWLEDGED },
        { actorId: "user-1" },
        ctsViewer,
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
});

describe("IncidentsService comment visibility", () => {
  it("excludes internal comments for CTS_MANAGER_VIEWER", async () => {
    const comments = [
      { id: "c1", incidentId: "incident-1", isInternal: true, body: "internal note" },
      { id: "c2", incidentId: "incident-1", isInternal: false, body: "customer-visible" },
    ];
    const { service, prisma } = makeService();
    (prisma.incidentComment.findMany as jest.Mock).mockResolvedValue(comments);

    const result = await service.listComments("incident-1", ctsViewer);
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
    });

    const result = await service.getAttachmentDownloadUrl("incident-1", "attachment-1", engineer);
    expect(result).toEqual({ url: "https://signed.example/download" });
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
