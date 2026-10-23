import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { createHash, randomUUID } from "crypto";
import { createReadStream } from "fs";
import { unlink } from "fs/promises";
import {
  Attachment,
  InAppNotificationKind,
  Incident,
  IncidentComment,
  IncidentEvent,
  IncidentStatus,
  Prisma,
  Priority,
  UserRole,
} from "@prisma/client";
import type { NotificationEvent } from "@cts-dc-opsdesk/email-adapter";
import { NotificationsPublisher } from "../../common/notifications/notifications.publisher";
import { StorageService } from "../../common/storage/storage.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { Paginated } from "../../common/types/paginated.type";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthzService } from "../auth/authz.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { InboxService } from "../inbox/inbox.service";
import { incidentAccessWhere, ownIncidentsFilter } from "./incident-visibility";
import { levelForPriority } from "../inbox/notification-sound-rules.service";
import { SlaService } from "../sla/sla.service";
import { isAllowedAttachment, MAX_ATTACHMENT_SIZE_BYTES } from "./attachment.constants";
import { assertSiteAcceptsNewWork } from "../sites/site-status";
import { REPORT_FIELDS, ReportNames, ReportValues, diffReport, idsToName } from "./report-changes";
import { IssueReportingService } from "./issue-reporting.service";
import { ticketEntityRef, ticketRecipients, ticketStatusLabel } from "./ticket-mail";
import {
  INCIDENT_CREATED_EVENT,
  INCIDENT_UPDATED_EVENT,
  IncidentCreatedEvent,
  IncidentUpdatedEvent,
} from "./incident-events";
import { CreateIncidentAsCustomerDto } from "./dto/create-incident-as-customer.dto";
import { CreateIncidentCommentDto } from "./dto/create-incident-comment.dto";
import { CreateIncidentDto } from "./dto/create-incident.dto";
import { ListIncidentsQueryDto } from "./dto/list-incidents-query.dto";
import { SetTemplateStatusDto, TransitionIncidentDto } from "./dto/transition-incident.dto";
import { UpdateCcListDto } from "./dto/update-cc-list.dto";
import { UpdateCustomerReportDto, UpdateIncidentDto } from "./dto/update-incident.dto";
import {
  findTransitionRule,
  INCIDENT_ROUTING_ROLES,
  isOwnerOrElevated,
  OPEN_STATUSES,
  TRANSITION_RULES,
} from "./incident-transitions";
import type { TransitionDto, TransitionRule } from "./incident-transitions";
import {
  fieldsForPath,
  planTemplateStatus,
  TEMPLATE_STATUS_FOR,
  TEMPLATE_STATUS_LABEL,
  TEMPLATE_STATUSES,
  TemplateStatus,
} from "./incident-status-display";

/** How a status change reads in the reporting customer's bell. Mirrors the
 *  client portal's labels (apps/web/src/pages/client/clientTicket.ts). */
const CUSTOMER_STATUS_LABEL: Record<IncidentStatus, string> = {
  NEW: "received",
  ASSIGNED: "assigned to an engineer",
  ACKNOWLEDGED: "an engineer is on it",
  IN_PROGRESS: "work in progress",
  PENDING_VENDOR: "waiting on a vendor",
  PENDING_CUSTOMER: "we need something from you",
  RESOLVED: "resolved, please confirm it's fixed",
  CLOSED: "closed",
  REOPENED: "reopened",
  CANCELLED: "cancelled",
  BLOCKED: "blocked by another ticket",
  DUPLICATE: "closed as a duplicate",
};

/** A reporter can't edit a ticket that's finished. */
const CUSTOMER_FROZEN_STATUSES: IncidentStatus[] = [
  IncidentStatus.CLOSED,
  IncidentStatus.CANCELLED,
  IncidentStatus.DUPLICATE,
];

/** The report as it will be after `data` is applied (undefined = unchanged). */
function applyReportData(
  before: Incident,
  data: Prisma.IncidentUncheckedUpdateInput,
): ReportValues {
  const out = { ...before } as Record<string, unknown>;
  for (const { field } of REPORT_FIELDS) {
    const value = (data as Record<string, unknown>)[field];
    if (value !== undefined) out[field] = value;
  }
  return out as unknown as ReportValues;
}

/** Field equality for the REPORT_EDITED timeline entry (arrays by content). */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/** Impact and urgency recorded on an incident opened from an alert, where no
 *  person assessed them; they mirror the priority the alert rule gave it. */
const PRIORITY_IMPACT_URGENCY: Record<Priority, [string, string]> = {
  P1: ["HIGH", "HIGH"],
  P2: ["HIGH", "MEDIUM"],
  P3: ["MEDIUM", "MEDIUM"],
  P4: ["LOW", "LOW"],
};

export interface AvailableTransition {
  toStatus: IncidentStatus;
  /** Fields the transition endpoint will require in the request body. */
  requiredFields: (keyof TransitionDto)[];
  /** False when the role check passed but the owner-or-elevated gate didn't. */
  allowed: boolean;
  /** Human explanation for why `allowed` is false — undefined when true. */
  blockedReason?: string;
  /**
   * What `rule.validate()` would currently say if this transition were
   * submitted with no extra fields filled in — e.g. NEW -> ASSIGNED needs
   * an owner resolved, but that's a custom validate() check (either
   * ownerGroupId or ownerUserId), not a simple "field present" entry in
   * requiredFields. Undefined when the rule has no validate(), or the
   * incident already satisfies it as-is.
   */
  hint?: string;
}

/** One row of the issue template's Status list (GET /incidents/:id/status-options). */
export interface TemplateStatusOption {
  status: TemplateStatus;
  label: string;
  /** What the ticket shows as now. */
  current: boolean;
  /** The caller can reach it from here. */
  available: boolean;
  /** The transitions picking it would run, in order. */
  steps: IncidentStatus[];
  /** Fields the request must carry for those steps. */
  fields: (keyof TransitionDto)[];
  /** What the first step's own check says as things stand (e.g. no owner yet). */
  hint?: string;
}

/** A conversation message as both portals read it: who wrote it, by name,
 *  and the files sent with it. */
export type CommentView = IncidentComment & {
  author: { id: string; displayName: string; role: UserRole | null };
  attachments: Attachment[];
};

/** Minimal shape of what NestJS's FileInterceptor hands us (multer.File). */
/** A monitoring alert as the incident timeline records it (`ALERT_LINKED`). */
export interface LinkableAlert {
  id: string;
  alertType: string;
  severity: string;
  source: string;
  fingerprint: string;
  summary?: string | null;
  /** Failing sub-component, e.g. a drive bay or interface. */
  componentKey?: string | null;
}

export interface UploadedAttachmentFile {
  originalname: string;
  mimetype: string;
  size: number;
  /** Set when the upload was streamed to disk (the HTTP route). */
  path?: string;
  /** Set for in-memory uploads (tests, internal callers). */
  buffer?: Buffer;
}

/** What a client report resolved to before the row is written — see
 *  IssueReportingService.resolveAssignment. Never taken from a body as-is. */
export interface IncidentIntake {
  ownerGroupId: string | null;
  ownerUserId: string | null;
  templateId?: string;
}

/** SHA-256 of an upload, read from disk in chunks when it was streamed there. */
async function sha256Of(file: UploadedAttachmentFile): Promise<string> {
  const hash = createHash("sha256");
  if (file.path) {
    for await (const chunk of createReadStream(file.path)) hash.update(chunk as Buffer);
  } else if (file.buffer) {
    hash.update(file.buffer);
  }
  return hash.digest("hex");
}

/** A ticket email's event before the ticket's own details are filled in. */
type WithoutEntity<E> = E extends unknown ? Omit<E, "entity"> : never;
type TicketMailEvent = WithoutEntity<NotificationEvent>;

/** Staff-only fields an edit changed, for a mail to the assignee and group. */
function describeStaffOnlyChanges(before: Incident, after: Incident): string[] {
  return (
    [
      ["Impact", "impact"],
      ["Urgency", "urgency"],
      ["Category", "category"],
    ] as const
  )
    .filter(([, key]) => (after[key] ?? "") !== (before[key] ?? ""))
    .map(([label, key]) => `${label}: ${before[key] ?? "none"} → ${after[key] ?? "none"}`)
    .concat(after.ciId !== before.ciId ? ["Configuration item changed"] : []);
}

/** "Acknowledged" for ACKNOWLEDGED: when two states share a template label. */
function rawStatusLabel(status: IncidentStatus): string {
  const words = status.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** multer hands over a UTF-8 file name decoded as latin1; undo that. */
function uploadFileName(name: string): string {
  if ([...name].some((ch) => ch.charCodeAt(0) > 0xff)) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes(String.fromCharCode(0xfffd)) ? name : decoded;
}

/**
 * Owns: incident state machine, assignment, comments (spec §10.3, §12, §15).
 * Must not own vendor polling.
 *
 * Site scope note: same shape as CmdbService — `/incidents/:id` identifies
 * the resource by its own id, not a site id, so SiteScopeGuard doesn't apply
 * here either. `assertSiteAccess()` is the explicit equivalent.
 *
 * Status changes never happen here — see IncidentsTransitionService.
 */
@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly authzService: AuthzService,
    private readonly storageService: StorageService,
    private readonly slaService: SlaService,
    private readonly notifications: NotificationsPublisher,
    private readonly events: EventEmitter2,
    private readonly inbox: InboxService,
    private readonly issueReporting: IssueReportingService,
  ) {}

  async assertSiteAccess(user: AuthenticatedUser, siteId: string): Promise<void> {
    const allowed = await this.authzService.canAccessSite(user, siteId);
    if (!allowed) {
      throw new ForbiddenException("You do not have access to this site");
    }
  }

  async findAll(
    query: ListIncidentsQueryDto,
    accessibleSiteIds: string[] | null | undefined,
    user: AuthenticatedUser,
  ): Promise<Paginated<Incident>> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    // Site access plus tickets assigned/offered to the caller (see
    // incidentAccessWhere); clients are scoped by reporter instead.
    const access =
      user.role === UserRole.CLIENT_MANAGER_VIEWER
        ? accessibleSiteIds
          ? { siteId: { in: accessibleSiteIds } }
          : undefined
        : incidentAccessWhere(user, accessibleSiteIds);

    const where: Prisma.IncidentWhereInput = {
      // ?siteId= only narrows what the caller may already see.
      siteId: query.siteId ?? undefined,
      // Same reasoning as findOneScoped: site access is a staff-shaped
      // grant, not "this is my ticket." Forced, never client-settable —
      // there's no ?reportedByUserId= query param a customer could spoof
      // even if they tried; this branches on the caller's own role only.
      reportedByUserId: user.role === UserRole.CLIENT_MANAGER_VIEWER ? user.id : undefined,
      // Under AND so it can't collide with the ?q= search's own OR below.
      AND: access ?? undefined,
      // An explicit ?status= wins; slaAtRisk alone still implies "open"
      // (a resolved incident's stale fired-milestone history isn't
      // actionable risk) — matches ReportsService's own queue definition.
      status: query.status ?? (query.slaAtRisk ? { in: OPEN_STATUSES } : undefined),
      priority: query.priority,
      ownerUserId: query.ownerUserId,
      ownerGroupId: query.ownerGroupId,
      ciId: query.ciId,
      slaInstances: query.slaAtRisk
        ? { some: { breached: false, firedMilestones: { isEmpty: false } } }
        : undefined,
      OR: query.q
        ? [
            { incidentNo: { contains: query.q, mode: "insensitive" } },
            { shortDescription: { contains: query.q, mode: "insensitive" } },
          ]
        : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.incident.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      this.prisma.incident.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  async findOne(id: string): Promise<Incident> {
    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident) {
      throw new NotFoundException(`Incident ${id} not found`);
    }
    return incident;
  }

  async findOneScoped(id: string, user: AuthenticatedUser): Promise<Incident> {
    const incident = await this.findOne(id);
    // Staff: site access, or the ticket is assigned/offered to them — the
    // same rule as their list (incidentAccessWhere). Every incident
    // sub-resource (comments, worklogs, attachments, transitions, routing
    // offers) comes through here.
    if (user.role !== UserRole.CLIENT_MANAGER_VIEWER) {
      if (incident.ownerUserId === user.id) return incident;
      const access = incidentAccessWhere(user, await this.authzService.getAccessibleSiteIds(user));
      if (access) {
        const visible = await this.prisma.incident.count({ where: { id, AND: access } });
        if (visible === 0) {
          throw new ForbiddenException("You do not have access to this incident");
        }
      }
      return incident;
    }
    await this.assertSiteAccess(user, incident.siteId);
    // Site access alone is staff-shaped scoping — every internal role at a
    // site can see every incident there. A CLIENT_MANAGER_VIEWER isn't staff:
    // the client portal's entire promise is "track your own ticket," not
    // "see every ticket your site has ever raised" (which would leak other
    // reporters' incidents, including ones with no connection to this
    // caller at all — see reportedByUserId, added for exactly this reason).
    if (incident.reportedByUserId !== user.id) {
      throw new ForbiddenException("You do not have access to this incident");
    }
    return incident;
  }

  /** userId -> how many open incidents of each priority they currently
   * own, across all sites (an engineer's workload doesn't stop at one site).
   * Engineers with no open incidents are simply absent from the map. Used by
   * the routing module's weighted least-loaded ranking. */
  async countOpenOwnedByPriority(
    userIds: string[],
  ): Promise<Map<string, Partial<Record<Priority, number>>>> {
    const counts = new Map<string, Partial<Record<Priority, number>>>();
    if (userIds.length === 0) {
      return counts;
    }
    const rows = await this.prisma.incident.groupBy({
      by: ["ownerUserId", "priority"],
      where: { ownerUserId: { in: userIds }, status: { in: OPEN_STATUSES } },
      _count: { _all: true },
    });
    for (const row of rows) {
      if (row.ownerUserId) {
        const byPriority = counts.get(row.ownerUserId) ?? {};
        byPriority[row.priority] = row._count._all;
        counts.set(row.ownerUserId, byPriority);
      }
    }
    return counts;
  }

  private async nextIncidentNo(tx: Prisma.TransactionClient): Promise<string> {
    // A real sequence, not count()+1 — avoids a race under concurrent
    // incident creation producing a duplicate/failed-unique-constraint
    // number (see Sprint 4 plan, Decision 2).
    const [{ nextval }] = await tx.$queryRaw<
      { nextval: bigint }[]
    >`SELECT nextval('incident_no_seq') AS nextval`;
    return `INC-${nextval.toString().padStart(6, "0")}`;
  }

  // `reportedByUserId` is never client-settable — only createFromCustomer()
  // passes it, straight from the authenticated caller's own id, never from
  // request body input. `intake` is likewise internal: the Assignee Group /
  // Assignee a client report resolved through IssueReportingService, plus
  // the template it was drafted from, for the timeline.
  async create(
    dto: CreateIncidentDto,
    actor: ActorContext,
    reportedByUserId?: string,
    intake?: IncidentIntake,
  ) {
    await assertSiteAcceptsNewWork(this.prisma, dto.siteId);
    const incident = await this.prisma.$transaction((tx) =>
      this.createInTx(
        tx,
        dto,
        actor,
        reportedByUserId,
        intake ? { source: "CUSTOMER_REPORT", templateId: intake.templateId ?? null } : undefined,
        intake,
      ),
    );
    await this.afterCreate(incident, actor);
    return incident;
  }

  /**
   * Opens an incident for a monitoring alert on a CI that has no open
   * incident yet, and links the alert to it. Called by the alerts module
   * when an alert rule's auto-create severities match. A per-CI advisory
   * lock serializes the "any open incident?" check with the insert, so two
   * alerts arriving together for the same device can't open two tickets.
   * If one is already open, the alert is linked to it instead.
   */
  async createFromAlert(
    input: {
      siteId: string;
      ciId: string;
      category: string;
      priority: Priority;
      shortDescription: string;
      alert: LinkableAlert;
    },
    actor: ActorContext,
  ): Promise<{ incident: Incident; created: boolean }> {
    const [impact, urgency] = PRIORITY_IMPACT_URGENCY[input.priority];
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.ciId}))::text`;
      const open = await tx.incident.findFirst({
        where: { ciId: input.ciId, status: { in: IncidentsService.OPEN_INCIDENT_STATUSES } },
        orderBy: { createdAt: "desc" },
      });
      if (open) {
        await this.writeAlertLink(tx, open.id, input.alert, actor);
        return { incident: open, created: false };
      }
      const incident = await this.createInTx(
        tx,
        {
          siteId: input.siteId,
          ciId: input.ciId,
          category: input.category,
          impact,
          urgency,
          priority: input.priority,
          shortDescription: input.shortDescription.slice(0, 256),
        },
        actor,
        undefined,
        { source: "ALERT", alertId: input.alert.id },
      );
      await this.writeAlertLink(tx, incident.id, input.alert, actor);
      return { incident, created: true };
    });
    if (result.created) {
      await this.afterCreate(result.incident, actor);
    }
    return result;
  }

  private async afterCreate(incident: Incident, actor: ActorContext): Promise<void> {
    await this.notifyServiceDeskOfNewIncident(incident, actor.actorId);
    const createdEvent: IncidentCreatedEvent = {
      incidentId: incident.id,
      siteId: incident.siteId,
      ciId: incident.ciId,
      actorId: actor.actorId,
      correlationId: actor.correlationId,
    };
    this.events.emit(INCIDENT_CREATED_EVENT, createdEvent);
  }

  private async createInTx(
    tx: Prisma.TransactionClient,
    dto: CreateIncidentDto,
    actor: ActorContext,
    reportedByUserId?: string,
    origin?: Record<string, unknown>,
    intake?: IncidentIntake,
  ): Promise<Incident> {
    const incidentNo = await this.nextIncidentNo(tx);
    const incident = await tx.incident.create({
      data: {
        incidentNo,
        siteId: dto.siteId,
        ciId: dto.ciId,
        category: dto.category,
        impact: dto.impact,
        urgency: dto.urgency,
        priority: dto.priority,
        shortDescription: dto.shortDescription,
        description: dto.description,
        issueType: dto.issueType,
        severity: dto.severity,
        component: dto.component,
        subComponent: dto.subComponent,
        tool: dto.tool,
        refIncidentNo: dto.refIncidentNo || undefined,
        ccEmails: dto.ccEmails ?? [],
        ownerGroupId: intake?.ownerGroupId ?? undefined,
        ownerUserId: intake?.ownerUserId ?? undefined,
        reportedByUserId,
      },
    });
    await tx.incidentEvent.create({
      data: {
        incidentId: incident.id,
        eventType: "CREATED",
        actorId: actor.actorId,
        payload: { status: incident.status, ...origin } as Prisma.InputJsonValue,
      },
    });
    await this.auditService.record(
      {
        actorId: actor.actorId,
        entityType: "Incident",
        entityId: incident.id,
        action: "CREATE",
        after: incident,
        correlationId: actor.correlationId,
      },
      tx,
    );
    // SLA clock starts the moment a qualifying incident is created (spec
    // §10.8) — same transaction as the incident row, never a follow-up call.
    await this.slaService.startForIncident(
      tx,
      { id: incident.id, siteId: incident.siteId },
      incident.priority,
      actor,
    );
    return incident;
  }

  /**
   * Self-service intake for a site POC (CLIENT_MANAGER_VIEWER). Deliberately
   * thin over `create()`: a customer never sets priority/impact/urgency or
   * picks a CI — those are triage decisions Service Desk makes afterward
   * via the normal PATCH /incidents/:id path (which already re-fires the
   * SLA clock on a priority change, so a P3 default here is a real starting
   * point, not a placeholder that needs special-casing later).
   */
  /**
   * The client portal's "Report an issue" form. Every pick-list value is
   * checked against the live issue catalog, the Assignee Group defaults to
   * the flagged Service Desk group, an Assignee must belong to that group,
   * and a Ref Bug ID must be a real ticket — all server-side, whatever the
   * form sent. Status is always NEW; impact/urgency follow the chosen
   * priority (P3 when none was picked) until the desk reclassifies via
   * PATCH /incidents/:id. The issue type doubles as `category` so routing's
   * category-team mapping keeps working for client reports.
   */
  async createFromCustomer(
    dto: CreateIncidentAsCustomerDto,
    actor: ActorContext,
    user: AuthenticatedUser,
  ): Promise<Incident> {
    await this.assertSiteAccess(user, dto.siteId);
    await assertSiteAcceptsNewWork(this.prisma, dto.siteId);
    await this.issueReporting.assertValidSelections(dto, { requireIssueType: true });
    const assignment = await this.issueReporting.resolveAssignment(
      dto.ownerGroupId,
      dto.ownerUserId,
      { clientPick: true },
    );
    const refIncidentNo = dto.refIncidentNo
      ? await this.issueReporting.resolveRefIncidentNo(dto.refIncidentNo)
      : undefined;
    const priority = dto.priority ?? Priority.P3;
    const [impact, urgency] = PRIORITY_IMPACT_URGENCY[priority];

    const incident = await this.create(
      {
        siteId: dto.siteId,
        category: dto.issueType,
        impact,
        urgency,
        priority,
        shortDescription: dto.subject,
        description: dto.description?.trim() || undefined,
        issueType: dto.issueType,
        severity: dto.severity,
        component: dto.component,
        subComponent: dto.subComponent,
        tool: dto.tool,
        refIncidentNo,
        ccEmails: this.issueReporting.normalizeCcEmails(dto.ccEmails),
      },
      actor,
      user.id,
      { ...assignment, templateId: dto.templateId },
    );

    if (incident.ownerUserId) {
      await this.notifyAssignment(incident, incident.ownerUserId, actor.actorId);
    } else if (incident.ownerGroupId) {
      await this.notifyGroupAssignment(incident, incident.ownerGroupId, actor.actorId);
    }

    return incident;
  }

  /**
   * "CC List: list of emails added by either reporter / assignee." The
   * reporter reaches their own ticket through findOneScoped like every
   * other customer write; staff reach any ticket in their site scope.
   */
  async updateCcList(
    id: string,
    dto: UpdateCcListDto,
    actor: ActorContext,
    user: AuthenticatedUser,
  ): Promise<Incident> {
    const before = await this.findOneScoped(id, user);
    const ccEmails = this.issueReporting.normalizeCcEmails(dto.ccEmails);
    const after = await this.prisma.$transaction(async (tx) => {
      const after = await tx.incident.update({ where: { id }, data: { ccEmails } });
      await tx.incidentEvent.create({
        data: {
          incidentId: id,
          eventType: "CC_LIST_CHANGED",
          actorId: actor.actorId,
          payload: { from: before.ccEmails, to: ccEmails } as Prisma.InputJsonValue,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Incident",
          entityId: id,
          action: "UPDATE",
          before: { ccEmails: before.ccEmails },
          after: { ccEmails },
          correlationId: actor.correlationId,
        },
        tx,
      );
      return after;
    });
    // Whoever changed it, everyone on the ticket hears, including whoever
    // was just added (they are on Cc of this very mail).
    if (!sameValue(before.ccEmails, ccEmails)) {
      await this.mailTicket(
        after,
        {
          kind: "INCIDENT_UPDATED",
          changes: [`CC list is now: ${ccEmails.length > 0 ? ccEmails.join(", ") : "empty"}`],
        },
        { userId: actor.actorId },
      );
    }
    return after;
  }

  async update(id: string, dto: UpdateIncidentDto, user: AuthenticatedUser, actor: ActorContext) {
    const before = await this.findOneScoped(id, user);
    const ownerChanged =
      (dto.ownerGroupId !== undefined && dto.ownerGroupId !== before.ownerGroupId) ||
      (dto.ownerUserId !== undefined && dto.ownerUserId !== before.ownerUserId);
    const priorityChanged = dto.priority !== undefined && dto.priority !== before.priority;

    // Routing (who owns the ticket) and priority overrides are a Service
    // Desk/elevated call, not Site Engineer's — see INCIDENT_ROUTING_ROLES.
    // Gated on the value actually changing, not just being present: the
    // edit form always round-trips the ticket's *current* owner/group in
    // the PATCH body, so a presence-only check would block a Site Engineer
    // from editing anything else on a ticket they already own.
    if ((ownerChanged || priorityChanged) && !INCIDENT_ROUTING_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        "Only Service Desk/NOC or an elevated role can reassign ownership or override priority",
      );
    }
    this.assertDescriptionUnchanged(before, dto.description);

    // The template's pick-lists are validated against the merged result,
    // so changing the component alone can't leave a mismatched sub
    // component behind. Values the ticket already holds stay valid even
    // after an admin retires them.
    await this.issueReporting.assertValidSelections(
      {
        issueType: dto.issueType ?? before.issueType ?? undefined,
        severity: dto.severity ?? before.severity ?? undefined,
        component: dto.component ?? before.component ?? undefined,
        subComponent: dto.subComponent ?? before.subComponent ?? undefined,
        tool: dto.tool ?? before.tool ?? undefined,
      },
      { keep: before },
    );
    const refIncidentNo = await this.resolveRefIncidentEdit(before, dto.refIncidentNo);
    const ccEmails =
      dto.ccEmails === undefined ? undefined : this.issueReporting.normalizeCcEmails(dto.ccEmails);

    const after = await this.persistUpdate(
      before,
      {
        shortDescription: dto.shortDescription,
        category: dto.category,
        impact: dto.impact,
        urgency: dto.urgency,
        ciId: dto.ciId,
        ownerGroupId: dto.ownerGroupId,
        ownerUserId: dto.ownerUserId,
        priority: dto.priority,
        issueType: dto.issueType,
        severity: dto.severity,
        component: dto.component,
        subComponent: dto.subComponent,
        tool: dto.tool,
        refIncidentNo,
        ccEmails,
      },
      actor,
      { ownerChanged, priorityChanged },
    );
    // One mail per saved edit. Changes the client can see go to everyone;
    // an edit of staff-only fields (impact, urgency, category, CI) goes to
    // the assignee and group only.
    const changes = await this.describeCustomerChanges(before, after);
    const staffChanges = describeStaffOnlyChanges(before, after);
    if (changes.length > 0 || staffChanges.length > 0) {
      await this.mailTicket(
        after,
        { kind: "INCIDENT_UPDATED", changes: changes.length > 0 ? changes : staffChanges },
        { userId: actor.actorId },
        { internal: changes.length === 0 },
      );
    }
    return after;
  }

  /**
   * The reporter editing their own ticket from the client portal: every
   * field of the issue template except Description (frozen once raised)
   * and Status (staff only, through the transition rules). Same checks as
   * a new report — catalog values, Assignee Group a client may pick, an
   * Assignee who belongs to it, a real Ref Bug ID — and a priority change
   * re-targets the SLA exactly like a desk override does.
   */
  async updateFromCustomer(
    id: string,
    dto: UpdateCustomerReportDto,
    actor: ActorContext,
    user: AuthenticatedUser,
  ): Promise<Incident> {
    const before = await this.findOneScoped(id, user);
    if (CUSTOMER_FROZEN_STATUSES.includes(before.status)) {
      throw new BadRequestException(
        "This ticket is closed. Report a new issue and mention its number instead.",
      );
    }
    const clear = (v: string | undefined, current: string | null) =>
      v === undefined ? current : v.trim() === "" ? null : v.trim();
    const severity = clear(dto.severity, before.severity);
    const component = clear(dto.component, before.component);
    // A new component drops a sub component that was under the old one,
    // unless one was sent with it.
    const subComponent =
      dto.subComponent !== undefined
        ? clear(dto.subComponent, before.subComponent)
        : component !== before.component
          ? null
          : before.subComponent;
    const issueType = dto.issueType ?? before.issueType;
    await this.issueReporting.assertValidSelections(
      {
        issueType: issueType ?? undefined,
        severity: severity ?? undefined,
        component: component ?? undefined,
        subComponent: subComponent ?? undefined,
      },
      { keep: before },
    );

    let ownerGroupId = before.ownerGroupId;
    let ownerUserId = before.ownerUserId;
    if (dto.ownerGroupId !== undefined || dto.ownerUserId !== undefined) {
      const groupChanged =
        dto.ownerGroupId !== undefined && dto.ownerGroupId !== before.ownerGroupId;
      const wantedUser =
        dto.ownerUserId !== undefined
          ? dto.ownerUserId || undefined
          : groupChanged
            ? undefined
            : (before.ownerUserId ?? undefined);
      const resolved = await this.issueReporting.resolveAssignment(
        dto.ownerGroupId ?? before.ownerGroupId ?? undefined,
        wantedUser,
        { clientPick: groupChanged },
      );
      ownerGroupId = resolved.ownerGroupId;
      ownerUserId = resolved.ownerUserId;
    }
    const ownerChanged = ownerGroupId !== before.ownerGroupId || ownerUserId !== before.ownerUserId;
    const priorityChanged = dto.priority !== undefined && dto.priority !== before.priority;
    const refIncidentNo = await this.resolveRefIncidentEdit(before, dto.refIncidentNo);
    const ccEmails =
      dto.ccEmails === undefined ? undefined : this.issueReporting.normalizeCcEmails(dto.ccEmails);

    const data: Prisma.IncidentUncheckedUpdateInput = {
      shortDescription: dto.subject?.trim() || undefined,
      issueType,
      severity,
      component,
      subComponent,
      ownerGroupId,
      ownerUserId,
      priority: dto.priority,
      refIncidentNo,
      ccEmails,
    };
    // The issue type doubles as the routing category on a client report;
    // keep them in step unless the desk has reclassified the category.
    if (issueType && before.category === before.issueType) {
      data.category = issueType;
    }
    // Old → new per field, with names: shown in the ticket's conversation
    // to the client and the service desk (REPORT_EDITED timeline entry).
    const preview = applyReportData(before, data);
    const reportChanges = diffReport(before, preview, await this.reportNames(before, preview));
    const after = await this.persistUpdate(before, data, actor, {
      ownerChanged,
      priorityChanged,
      timelineEvent: "REPORT_EDITED",
      timelinePayload: { changes: reportChanges },
    });
    const changes = await this.describeCustomerChanges(before, after);
    if (changes.length > 0) {
      await this.notifyReporterEdit(after, changes, user.id);
      await this.mailTicket(after, { kind: "INCIDENT_UPDATED", changes }, { userId: user.id });
    }
    return after;
  }

  /** "Description is frozen once the ticket is raised" — on every portal. */
  private assertDescriptionUnchanged(before: Incident, description: string | undefined): void {
    if (description !== undefined && description.trim() !== (before.description ?? "").trim()) {
      throw new BadRequestException(
        "The description can't be changed once the ticket is raised. Add detail as a comment instead.",
      );
    }
  }

  /** An edit's Ref Bug ID: undefined leaves it, "" clears it, else it must exist. */
  private async resolveRefIncidentEdit(
    before: Incident,
    raw: string | undefined,
  ): Promise<string | null | undefined> {
    if (raw === undefined) return undefined;
    if (raw.trim() === "") return null;
    const refIncidentNo = await this.issueReporting.resolveRefIncidentNo(raw);
    if (refIncidentNo === before.incidentNo) {
      throw new BadRequestException("A ticket cannot reference itself");
    }
    return refIncidentNo;
  }

  /**
   * One edit, in one transaction: the row, an OWNER_CHANGE timeline entry
   * when ownership moved, an optional extra timeline entry naming the
   * changed fields, the audit record and the SLA re-target on a priority
   * change. Then the assignment notifications and the updated event.
   */
  private async persistUpdate(
    before: Incident,
    data: Prisma.IncidentUncheckedUpdateInput,
    actor: ActorContext,
    opts: {
      ownerChanged: boolean;
      priorityChanged: boolean;
      timelineEvent?: string;
      /** Extra payload for the timeline entry (e.g. a report edit's old → new values). */
      timelinePayload?: Record<string, unknown>;
    },
  ): Promise<Incident> {
    const id = before.id;
    const after = await this.prisma.$transaction(async (tx) => {
      const after = await tx.incident.update({ where: { id }, data });

      if (opts.ownerChanged) {
        await tx.incidentEvent.create({
          data: {
            incidentId: id,
            eventType: "OWNER_CHANGE",
            actorId: actor.actorId,
            payload: {
              fromOwnerUserId: before.ownerUserId,
              toOwnerUserId: after.ownerUserId,
              fromOwnerGroupId: before.ownerGroupId,
              toOwnerGroupId: after.ownerGroupId,
            } as Prisma.InputJsonValue,
          },
        });
      }

      if (opts.timelineEvent) {
        const fields = (Object.keys(data) as (keyof Incident)[]).filter(
          (k) => data[k as keyof typeof data] !== undefined && !sameValue(before[k], after[k]),
        );
        if (fields.length > 0) {
          await tx.incidentEvent.create({
            data: {
              incidentId: id,
              eventType: opts.timelineEvent,
              actorId: actor.actorId,
              payload: { fields, ...opts.timelinePayload } as Prisma.InputJsonValue,
            },
          });
        }
      }

      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Incident",
          entityId: id,
          action: "UPDATE",
          before,
          after,
          correlationId: actor.correlationId,
        },
        tx,
      );

      if (opts.priorityChanged) {
        await this.slaService.onPriorityChanged(
          tx,
          { id, siteId: before.siteId },
          after.priority,
          actor,
        );
      }

      return after;
    });

    if (opts.ownerChanged && after.ownerUserId) {
      await this.notifyAssignment(after, after.ownerUserId, actor.actorId);
    } else if (opts.ownerChanged && after.ownerGroupId && !after.ownerUserId) {
      await this.notifyGroupAssignment(after, after.ownerGroupId, actor.actorId);
    }
    this.emitUpdated(after, actor);
    return after;
  }

  /** Group and user names for a report diff. */
  private async reportNames(before: ReportValues, after: ReportValues): Promise<ReportNames> {
    const { groupIds, userIds } = idsToName(before, after);
    const [groups, users] = await Promise.all([
      groupIds.length
        ? this.prisma.supportGroup.findMany({
            where: { id: { in: groupIds } },
            select: { id: true, name: true },
          })
        : [],
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, displayName: true },
          })
        : [],
    ]);
    return {
      groups: new Map(groups.map((g) => [g.id, g.name])),
      users: new Map(users.map((u) => [u.id, u.displayName])),
    };
  }

  /** The desk hears when the reporter changes their own ticket. */
  private async notifyReporterEdit(
    incident: Incident,
    changes: string[],
    actorUserId: string,
  ): Promise<void> {
    try {
      await this.inbox.notifyUsers({
        userIds: await this.supportRecipientIds(incident),
        actorUserId,
        kind: InAppNotificationKind.CUSTOMER_RESPONDED,
        title: `${incident.incidentNo}: the reporter updated the ticket`,
        body: changes.join("; ").slice(0, 400),
        entityType: "INCIDENT",
        entityId: incident.id,
        level: levelForPriority(incident.priority),
        dedupeKey: `report-edit:${incident.id}:${incident.updatedAt.getTime()}`,
      });
    } catch (err) {
      this.logger.warn(
        `reporter-edit notification skipped for incident ${incident.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Plain-language lines for the customer-facing "ticket updated" mail. */
  private async describeCustomerChanges(before: Incident, after: Incident): Promise<string[]> {
    const changes: string[] = [];
    if (after.ownerUserId !== before.ownerUserId) {
      if (after.ownerUserId) {
        const owner = await this.prisma.user.findUnique({
          where: { id: after.ownerUserId },
          select: { displayName: true },
        });
        changes.push(`Now handled by ${owner?.displayName ?? "an engineer"}`);
      } else {
        changes.push("No engineer is assigned at the moment");
      }
    }
    if (after.ownerGroupId !== before.ownerGroupId && after.ownerGroupId) {
      const group = await this.prisma.supportGroup.findUnique({
        where: { id: after.ownerGroupId },
        select: { name: true },
      });
      if (group) {
        changes.push(`Assigned to the ${group.name} team`);
      }
    }
    if (after.priority !== before.priority) {
      changes.push(`Priority changed from ${before.priority} to ${after.priority}`);
    }
    if (after.shortDescription !== before.shortDescription) {
      changes.push(`Subject is now: ${after.shortDescription}`);
    }
    if ((after.description ?? "") !== (before.description ?? "")) {
      changes.push("Description updated");
    }
    const classification = (
      [
        ["Issue type", "issueType"],
        ["Severity", "severity"],
        ["Component", "component"],
        ["Sub component", "subComponent"],
        ["Tool", "tool"],
      ] as const
    )
      .filter(([, key]) => (after[key] ?? "") !== (before[key] ?? ""))
      .map(([label, key]) => `${label}: ${after[key] ?? "none"}`);
    if (classification.length > 0) {
      changes.push(`Classification updated (${classification.join(", ")})`);
    }
    if ((after.refIncidentNo ?? "") !== (before.refIncidentNo ?? "")) {
      changes.push(
        after.refIncidentNo ? `Linked to ticket ${after.refIncidentNo}` : "Ticket link removed",
      );
    }
    const ccAfter = after.ccEmails ?? [];
    const ccBefore = before.ccEmails ?? [];
    if (ccAfter.length !== ccBefore.length || ccAfter.some((e, i) => e !== ccBefore[i])) {
      changes.push(`CC list is now: ${ccAfter.length > 0 ? ccAfter.join(", ") : "empty"}`);
    }
    return changes;
  }

  /**
   * The one way a change to a ticket reaches people by email: subject
   * `INC-00002[Bug][P3,S3] Subject`, To the assignee and assignee group,
   * Cc the reporter and the CC list (never on an internal mail), and a
   * first line naming who did it (see ticket-mail.ts). Each operation sends
   * exactly one. The row is read as it is *now*, so a CC-list edit reaches
   * the new addresses with this very mail. Best-effort: the change is
   * already saved and audited, so a failure here is logged, never thrown.
   */
  private async mailTicket(
    incident: Incident,
    event: TicketMailEvent,
    by: { userId?: string | null; name?: string },
    opts: { internal?: boolean; jobId?: string } = {},
  ): Promise<void> {
    try {
      const recipients = await ticketRecipients(this.prisma, incident, opts);
      if (!recipients) {
        return;
      }
      const entity = await ticketEntityRef(this.prisma, incident, by);
      await this.notifications.enqueue(
        { event: { ...event, entity } as NotificationEvent, recipients },
        opts.jobId,
      );
    } catch (err) {
      this.logger.warn(
        `${event.kind} email skipped for incident ${incident.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // --- Status transitions (spec §15) ----------------------------------
  //
  // The only place Incident.status ever changes. Guard/controller layer
  // handles coarse RBAC (INCIDENT_WRITE_ROLES); this method does the
  // per-transition role/ownership/field checks the rule table describes —
  // same layering CmdbService uses for site-scope (guard vs. resource check).

  async createTransition(
    id: string,
    dto: TransitionIncidentDto,
    actor: ActorContext,
    user: AuthenticatedUser,
  ) {
    const incident = await this.findOneScoped(id, user);

    const rule = findTransitionRule(incident.status, dto.toStatus);
    if (!rule) {
      throw new BadRequestException(
        `Cannot transition incident from ${incident.status} to ${dto.toStatus}`,
      );
    }

    if (!rule.allowedRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Role ${user.role} cannot perform ${incident.status} -> ${dto.toStatus}`,
      );
    }

    if (rule.requiresOwnerOrElevated && !isOwnerOrElevated(user.id, user.role, incident)) {
      throw new ForbiddenException(
        "Only the assigned owner or an elevated role can perform this transition",
      );
    }

    const missing = (rule.requiredFields ?? []).filter((field) => !dto[field]);
    if (missing.length > 0) {
      throw new BadRequestException(`Missing required field(s): ${missing.join(", ")}`);
    }

    const validationError = rule.validate?.(incident, dto);
    if (validationError) {
      throw new BadRequestException(validationError);
    }

    // "Blocked by" / "Duplicate of" record the other ticket as the Ref Bug
    // ID — it must exist and can't be this ticket.
    let refIncidentNo: string | undefined;
    if (dto.toStatus === IncidentStatus.BLOCKED || dto.toStatus === IncidentStatus.DUPLICATE) {
      refIncidentNo = await this.issueReporting.resolveRefIncidentNo(
        dto.refIncidentNo?.trim() || incident.refIncidentNo || "",
      );
      if (refIncidentNo === incident.incidentNo) {
        throw new BadRequestException("A ticket cannot be blocked by or duplicate itself");
      }
    }

    let openAlertsAtResolve: Awaited<ReturnType<typeof this.findOpenAlertsForIncident>> = [];
    if (dto.toStatus === "RESOLVED") {
      openAlertsAtResolve = await this.findOpenAlertsForIncident(id);
      if (openAlertsAtResolve.length > 0 && !dto.reason) {
        throw new BadRequestException(
          `${openAlertsAtResolve.length} linked alert(s) are still OPEN — monitoring hasn't ` +
            `reported the underlying condition as cleared (${this.summarizeAlerts(
              openAlertsAtResolve,
            )}). Provide "reason" to resolve anyway.`,
        );
      }
    }

    const after = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.IncidentUncheckedUpdateInput = { status: dto.toStatus };
      if (dto.ownerGroupId !== undefined) {
        data.ownerGroupId = dto.ownerGroupId;
      }
      if (dto.ownerUserId !== undefined) {
        data.ownerUserId = dto.ownerUserId;
      }
      if (dto.toStatus === "ACKNOWLEDGED") {
        data.acknowledgedAt = new Date();
      }
      if (dto.toStatus === "RESOLVED") {
        data.resolutionCategory = dto.resolutionCategory;
        data.rootCauseSummary = dto.rootCauseSummary;
        data.restoredAt = new Date();
      }
      if (dto.toStatus === "CLOSED") {
        data.closedAt = new Date();
      }
      if (refIncidentNo) {
        data.refIncidentNo = refIncidentNo;
      }

      const after = await tx.incident.update({ where: { id }, data });

      await tx.incidentEvent.create({
        data: {
          incidentId: id,
          eventType: "STATUS_CHANGE",
          actorId: actor.actorId,
          payload: {
            from: incident.status,
            to: dto.toStatus,
            reason: dto.reason,
            resolutionCategory: dto.resolutionCategory,
            rootCauseSummary: dto.rootCauseSummary,
            ...(refIncidentNo ? { refIncidentNo } : {}),
            ...(openAlertsAtResolve.length > 0
              ? {
                  resolvedWithOpenAlerts: openAlertsAtResolve.map((a) => ({
                    id: a.id,
                    alertType: a.alertType,
                    severity: a.severity,
                    state: a.state,
                  })),
                }
              : {}),
          } as Prisma.InputJsonValue,
        },
      });

      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Incident",
          entityId: id,
          action: "TRANSITION",
          before: incident,
          after,
          correlationId: actor.correlationId,
        },
        tx,
      );

      // SLA hooks (spec §10.8) — same transaction as the status write, one
      // per transition kind. `incident` here is the *pre*-transition row,
      // so PENDING_* -> IN_PROGRESS can tell a genuine resume apart from
      // ACKNOWLEDGED/REOPENED -> IN_PROGRESS (no pause to resume there).
      if (dto.toStatus === "ACKNOWLEDGED" && after.acknowledgedAt) {
        await this.slaService.onAcknowledged(tx, id, after.acknowledgedAt, actor);
      } else if (dto.toStatus === "RESOLVED" && after.restoredAt) {
        await this.slaService.onResolved(tx, id, after.restoredAt, actor);
      } else if (dto.toStatus === "PENDING_VENDOR" || dto.toStatus === "PENDING_CUSTOMER") {
        await this.slaService.onPaused(tx, id, dto.toStatus, actor);
      } else if (
        dto.toStatus === "IN_PROGRESS" &&
        (incident.status === "PENDING_VENDOR" || incident.status === "PENDING_CUSTOMER")
      ) {
        await this.slaService.onResumed(tx, id, actor);
      } else if (dto.toStatus === "REOPENED") {
        await this.slaService.onReopened(tx, id, actor);
      }

      return after;
    });

    await this.notifyStatusChange(incident, after, dto.reason, actor.actorId);
    if (dto.ownerUserId !== undefined && dto.ownerUserId !== incident.ownerUserId) {
      await this.notifyAssignment(after, dto.ownerUserId, actor.actorId);
    } else if (
      dto.ownerGroupId !== undefined &&
      dto.ownerGroupId !== incident.ownerGroupId &&
      after.ownerGroupId &&
      !after.ownerUserId
    ) {
      await this.notifyGroupAssignment(after, after.ownerGroupId, actor.actorId);
    }
    this.emitUpdated(after, actor);

    return after;
  }

  private emitUpdated(after: Incident, actor: ActorContext): void {
    const event: IncidentUpdatedEvent = {
      incidentId: after.id,
      status: after.status,
      ownerUserId: after.ownerUserId,
      ownerGroupId: after.ownerGroupId,
      ciId: after.ciId,
      actorId: actor.actorId,
      correlationId: actor.correlationId,
    };
    this.events.emit(INCIDENT_UPDATED_EVENT, event);
  }

  /**
   * Adds a ROUTING entry to the incident's timeline (offered, declined,
   * expired, nobody accepted). The routing module owns the offers but not
   * incident_events, so it records timeline entries through here.
   */
  async recordRoutingEvent(
    incidentId: string,
    actorId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.incidentEvent.create({
      data: {
        incidentId,
        eventType: "ROUTING",
        actorId,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * NEW -> ASSIGNED on behalf of skill-based routing. The routing module
   * calls it when an engineer accepts a routing offer, passing that
   * engineer as `acceptedBy`. Not createTransition(): an engineer can't
   * normally assign a NEW ticket to themselves. The authorization here is
   * the admin-enabled per-site RoutingPolicy plus the routing module's
   * check that the caller holds the open offer.
   * Everything else matches a human assign: the same rule table's
   * validate(), a STATUS_CHANGE timeline event, an audit record (actor is
   * the accepting engineer, or null for a system assign, with `source` on
   * the event), and the usual status/assignment notifications.
   * NEW -> ASSIGNED has no SLA hook, same as the human path.
   *
   * Returns null (and changes nothing) when the incident is no longer NEW
   * or an engineer already owns it — e.g. the desk assigned it first. A
   * group owner alone (a client report's default Assignee Group) doesn't
   * block it; the category team, when there is one, replaces that group.
   * The conditional updateMany makes that check atomic with the write.
   */
  async autoAssign(
    id: string,
    ownerUserId: string,
    correlationId?: string,
    acceptedBy?: string,
    ownerGroupId?: string,
  ): Promise<Incident | null> {
    const actorId = acceptedBy ?? null;
    const source = acceptedBy ? "ROUTING_OFFER" : "SKILL_ROUTING";
    const incident = await this.findOne(id);
    // A group on its own (e.g. the default Service Desk group a client
    // report lands in) doesn't make the ticket "taken": only an engineer
    // does. Skill routing therefore still offers group-owned NEW tickets.
    if (incident.status !== IncidentStatus.NEW || incident.ownerUserId) {
      return null;
    }

    const dto = { toStatus: IncidentStatus.ASSIGNED, ownerUserId };
    const rule = findTransitionRule(incident.status, dto.toStatus);
    const validationError = rule?.validate?.(incident, dto);
    if (!rule || validationError) {
      throw new BadRequestException(
        validationError ?? `Cannot transition incident from ${incident.status} to ASSIGNED`,
      );
    }

    const after = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.incident.updateMany({
        where: { id, status: IncidentStatus.NEW, ownerUserId: null },
        data: {
          status: IncidentStatus.ASSIGNED,
          ownerUserId,
          ...(ownerGroupId ? { ownerGroupId } : {}),
        },
      });
      if (count === 0) {
        return null;
      }
      const after = await tx.incident.findUniqueOrThrow({ where: { id } });

      await tx.incidentEvent.create({
        data: {
          incidentId: id,
          eventType: "STATUS_CHANGE",
          actorId,
          payload: {
            from: incident.status,
            to: after.status,
            ownerUserId,
            ...(ownerGroupId ? { ownerGroupId } : {}),
            source,
          } as Prisma.InputJsonValue,
        },
      });
      await this.auditService.record(
        {
          actorId,
          entityType: "Incident",
          entityId: id,
          action: "TRANSITION",
          before: incident,
          after,
          correlationId,
        },
        tx,
      );
      return after;
    });

    if (!after) {
      return null;
    }
    await this.notifyStatusChange(
      incident,
      after,
      acceptedBy ? "Accepted a routing offer" : "Auto-assigned by skill-based routing",
      acceptedBy,
    );
    await this.notifyAssignment(after, ownerUserId, acceptedBy);
    return after;
  }

  /**
   * What the caller could actually submit to `createTransition` right now,
   * computed from the same TRANSITION_RULES table that endpoint enforces —
   * not a second copy of the rules (the frontend deliberately doesn't mirror
   * them, see IncidentDetailPage.tsx's own comment). A rule the caller's
   * role can never perform is omitted entirely; one blocked only by the
   * owner-or-elevated gate is still returned (allowed: false) so the UI can
   * show *why*, e.g. a NOC agent seeing the ticket is theirs to resume once
   * the assigned engineer isn't around.
   */
  async getAvailableTransitions(
    id: string,
    user: AuthenticatedUser,
  ): Promise<AvailableTransition[]> {
    const incident = await this.findOneScoped(id, user);

    return Promise.all(
      TRANSITION_RULES.filter(
        (rule) => rule.from.includes(incident.status) && rule.allowedRoles.includes(user.role),
      ).map(async (rule) => {
        const allowed =
          !rule.requiresOwnerOrElevated || isOwnerOrElevated(user.id, user.role, incident);
        let hint = rule.validate?.(incident, { toStatus: rule.to });
        if (rule.to === "RESOLVED") {
          const openAlerts = await this.findOpenAlertsForIncident(incident.id);
          if (openAlerts.length > 0) {
            hint =
              `${openAlerts.length} linked alert(s) still OPEN — monitoring hasn't reported ` +
              `the underlying condition as cleared (${this.summarizeAlerts(openAlerts)}). ` +
              `A "reason" will be required to resolve anyway.`;
          }
        }
        return {
          toStatus: rule.to,
          requiredFields: rule.requiredFields ?? [],
          allowed,
          blockedReason: allowed
            ? undefined
            : "Only the assigned owner or an elevated role can perform this transition",
          hint,
        };
      }),
    );
  }

  /**
   * The issue template's Status list for this caller: every label, which
   * one the ticket shows as now, and for each other label whether the
   * caller can get there (the chain of transitions it would run and the
   * fields that chain needs). See incident-status-display.ts.
   */
  async getTemplateStatusOptions(
    id: string,
    user: AuthenticatedUser,
  ): Promise<TemplateStatusOption[]> {
    const incident = await this.findOneScoped(id, user);
    const current = TEMPLATE_STATUS_FOR[incident.status];
    const canUse = this.ruleCheckerFor(incident, user);
    return TEMPLATE_STATUSES.map((status) => {
      const path = status === current ? null : planTemplateStatus(incident.status, status, canUse);
      const firstHint = path?.[0].validate?.(incident, { toStatus: path[0].to });
      return {
        status,
        label: TEMPLATE_STATUS_LABEL[status],
        current: status === current,
        available: path !== null,
        steps: path?.map((r) => r.to) ?? [],
        fields: path ? fieldsForPath(path) : [],
        // The ref-ticket check is satisfied by filling the field in the form.
        hint: firstHint && !firstHint.startsWith("refIncidentNo") ? firstHint : undefined,
      };
    });
  }

  /**
   * Moves the ticket to one of the issue template's statuses by running
   * the planned chain of ordinary transitions, one createTransition() per
   * step (each re-checked, audited and SLA-hooked on its own). Fields are
   * checked for the whole chain up front; if a later step still fails
   * (e.g. a resolve blocked by open alerts), the earlier steps stay done
   * and the error says where the ticket stopped.
   */
  async setTemplateStatus(
    id: string,
    dto: SetTemplateStatusDto,
    actor: ActorContext,
    user: AuthenticatedUser,
  ): Promise<Incident> {
    const incident = await this.findOneScoped(id, user);
    const path = planTemplateStatus(
      incident.status,
      dto.status,
      this.ruleCheckerFor(incident, user),
    );
    if (!path) {
      throw new BadRequestException(
        TEMPLATE_STATUS_FOR[incident.status] === dto.status
          ? `The ticket is already "${TEMPLATE_STATUS_LABEL[dto.status]}"`
          : `You can't move this ticket to "${TEMPLATE_STATUS_LABEL[dto.status]}" from its current status`,
      );
    }
    const missing = fieldsForPath(path).filter(
      (f) =>
        !dto[f as keyof SetTemplateStatusDto] && !(f === "refIncidentNo" && incident.refIncidentNo),
    );
    if (missing.length > 0) {
      throw new BadRequestException(`Missing required field(s): ${missing.join(", ")}`);
    }
    let after = incident;
    for (const [i, rule] of path.entries()) {
      try {
        after = await this.createTransition(
          id,
          {
            toStatus: rule.to,
            reason: dto.reason,
            resolutionCategory: dto.resolutionCategory,
            rootCauseSummary: dto.rootCauseSummary,
            refIncidentNo: dto.refIncidentNo,
          },
          actor,
          user,
        );
      } catch (err) {
        if (i === 0) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw new BadRequestException(
          `Moved to ${after.status}, but couldn't continue to ${rule.to}: ${message}`,
        );
      }
    }
    return after;
  }

  private ruleCheckerFor(incident: Incident, user: AuthenticatedUser) {
    return (rule: TransitionRule) =>
      rule.allowedRoles.includes(user.role) &&
      (!rule.requiresOwnerOrElevated || isOwnerOrElevated(user.id, user.role, incident));
  }

  /**
   * Alerts linked to this incident (Alert.correlatedIncidentId) that monitoring
   * hasn't reported as RECOVERED yet — i.e. the real condition, not just the
   * ticket, still looks broken. Scalar read only, same as `linkAlert` below
   * reads/writes this incident's own table for alerts to call; the alerts
   * module owns the Alert row, this is a read-only cross-reference.
   *
   * Used to gate/hint a RESOLVED transition (CLAUDE.md: state transitions are
   * backend rules — an engineer clicking "Resolve" must not be able to make a
   * still-alerting CI read as fixed without at least explaining why).
   */
  private async findOpenAlertsForIncident(incidentId: string) {
    return this.prisma.alert.findMany({
      where: { correlatedIncidentId: incidentId, state: { not: "RECOVERED" } },
      orderBy: { lastSeenAt: "desc" },
    });
  }

  private summarizeAlerts(alerts: Array<{ alertType: string; severity: string }>): string {
    return alerts.map((a) => `${a.alertType} (${a.severity})`).join(", ");
  }

  // --- Cross-module: alert correlation (spec §10.10) ------------------
  //
  // The alerts module owns the Alert row; the incident timeline is ours,
  // so the seam is two methods here. `alerts` reads `findOpenByCi` to
  // decide whether an incoming alert belongs to an existing ticket, then
  // calls `linkAlert` to annotate this incident's timeline. Neither
  // changes incident status — correlation never drives the state machine.

  private static readonly OPEN_INCIDENT_STATUSES: IncidentStatus[] = [
    IncidentStatus.NEW,
    IncidentStatus.ASSIGNED,
    IncidentStatus.ACKNOWLEDGED,
    IncidentStatus.IN_PROGRESS,
    IncidentStatus.PENDING_VENDOR,
    IncidentStatus.PENDING_CUSTOMER,
    IncidentStatus.REOPENED,
    IncidentStatus.BLOCKED,
  ];

  /**
   * Other still-open incidents on the same CI as this one — most often a
   * client-reported ticket and the incident a monitoring alert already opened
   * for the same fault. Advisory only: Service Desk decides whether to link,
   * cancel or keep both; nothing is blocked. Visibility follows the caller's
   * own list scope (same site; a Site Engineer sees only their own; a client
   * never sees other reporters' tickets).
   */
  async findPossibleDuplicates(
    id: string,
    user: AuthenticatedUser,
  ): Promise<
    Pick<Incident, "id" | "incidentNo" | "shortDescription" | "status" | "priority" | "createdAt">[]
  > {
    const incident = await this.findOneScoped(id, user);
    if (
      !incident.ciId ||
      !IncidentsService.OPEN_INCIDENT_STATUSES.includes(incident.status) ||
      user.role === UserRole.CLIENT_MANAGER_VIEWER
    ) {
      return [];
    }
    return this.prisma.incident.findMany({
      where: {
        id: { not: incident.id },
        ciId: incident.ciId,
        siteId: incident.siteId,
        status: { in: IncidentsService.OPEN_INCIDENT_STATUSES },
        AND: ownIncidentsFilter(user) ?? undefined,
      },
      select: {
        id: true,
        incidentNo: true,
        shortDescription: true,
        status: true,
        priority: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Most-recently-created still-open incident for a CI, or null. Read-only. */
  async findOpenByCi(ciId: string): Promise<Incident | null> {
    return this.prisma.incident.findFirst({
      where: { ciId, status: { in: IncidentsService.OPEN_INCIDENT_STATUSES } },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Attach a monitoring alert to an incident's timeline as an `ALERT_LINKED`
   * event, audited in the same transaction. Idempotent — a repeat call for the
   * same alert id is a no-op (returns `{ linked: false }`). Called by the
   * alerts module during ingestion correlation.
   */
  async linkAlert(
    incidentId: string,
    alert: LinkableAlert,
    actor: ActorContext,
  ): Promise<{ linked: boolean }> {
    const incident = await this.prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) {
      throw new NotFoundException(`Incident ${incidentId} not found`);
    }

    const already = await this.prisma.incidentEvent.findFirst({
      where: {
        incidentId,
        eventType: "ALERT_LINKED",
        payload: { path: ["alertId"], equals: alert.id },
      },
    });
    if (already) {
      return { linked: false };
    }

    await this.prisma.$transaction((tx) => this.writeAlertLink(tx, incidentId, alert, actor));

    return { linked: true };
  }

  private async writeAlertLink(
    tx: Prisma.TransactionClient,
    incidentId: string,
    alert: LinkableAlert,
    actor: ActorContext,
  ): Promise<void> {
    await tx.incidentEvent.create({
      data: {
        incidentId,
        eventType: "ALERT_LINKED",
        actorId: actor.actorId,
        payload: {
          alertId: alert.id,
          alertType: alert.alertType,
          severity: alert.severity,
          source: alert.source,
          fingerprint: alert.fingerprint,
          // what actually broke (e.g. "DRIVE:Disk.Bay.3") so the timeline is
          // diagnosable without opening each alert
          summary: alert.summary ?? null,
          componentKey: alert.componentKey ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    await this.auditService.record(
      {
        actorId: actor.actorId,
        entityType: "Incident",
        entityId: incidentId,
        action: "ALERT_LINKED",
        after: {
          alertId: alert.id,
          alertType: alert.alertType,
          severity: alert.severity,
          source: alert.source,
          componentKey: alert.componentKey ?? null,
        },
        correlationId: actor.correlationId,
      },
      tx,
    );
  }

  /**
   * Recovery counterpart to `linkAlert` — called when an already-linked alert
   * genuinely clears (monitoring reports RECOVERED). If the ticket is still
   * open, the timeline gets an ALERT_RECOVERED entry and the owner (or team,
   * or service desk) a bell notification; nothing closes automatically. If
   * the ticket was already
   * RESOLVED/CLOSED — most notably via the open-alert override in
   * `createTransition()` — this closes the loop: writes an
   * `ALERT_RECOVERED_AFTER_RESOLVE` timeline event + audit record, and
   * best-effort emails the owner that the real problem is now actually fixed.
   * No-ops (returns `{ notified: false }`) when the incident is unknown or
   * cancelled.
   */
  async notifyAlertRecovered(
    incidentId: string,
    alert: { id: string; alertType: string; severity: string; source: string },
    actor: ActorContext,
  ): Promise<{ notified: boolean }> {
    const incident = await this.prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) {
      return { notified: false };
    }
    if (incident.status !== IncidentStatus.RESOLVED && incident.status !== IncidentStatus.CLOSED) {
      if (incident.status === IncidentStatus.CANCELLED) {
        return { notified: false };
      }
      await this.noteAlertRecoveredOnOpenIncident(incident, alert, actor);
      return { notified: true };
    }

    const recoveredAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.incidentEvent.create({
        data: {
          incidentId,
          eventType: "ALERT_RECOVERED_AFTER_RESOLVE",
          actorId: actor.actorId,
          payload: {
            alertId: alert.id,
            alertType: alert.alertType,
            severity: alert.severity,
            source: alert.source,
            incidentStatusAtRecovery: incident.status,
          } as Prisma.InputJsonValue,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Incident",
          entityId: incidentId,
          action: "ALERT_RECOVERED_AFTER_RESOLVE",
          after: {
            alertId: alert.id,
            alertType: alert.alertType,
            severity: alert.severity,
            incidentStatusAtRecovery: incident.status,
          },
          correlationId: actor.correlationId,
        },
        tx,
      );
    });

    await this.notifyAlertRecoveredEmail(
      incident,
      { id: alert.id, alertType: alert.alertType, severity: alert.severity },
      recoveredAt,
    );
    return { notified: true };
  }

  /** Best-effort — same posture as notifyAssignment/notifyStatusChange: a
   *  failed email must never undo the timeline/audit write that already
   *  landed. No-ops silently if the ticket has no owner on file. */
  /**
   * Monitoring reports the alert cleared while the ticket is still being
   * worked. Nothing closes automatically: the timeline records it and the
   * owner (or, with no owner, the assigned team or else the service desk)
   * gets a bell notification, so a person can confirm and close it.
   */
  private async noteAlertRecoveredOnOpenIncident(
    incident: Incident,
    alert: { id: string; alertType: string; severity: string; source: string },
    actor: ActorContext,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.incidentEvent.create({
        data: {
          incidentId: incident.id,
          eventType: "ALERT_RECOVERED",
          actorId: actor.actorId,
          payload: {
            alertId: alert.id,
            alertType: alert.alertType,
            severity: alert.severity,
            source: alert.source,
            incidentStatusAtRecovery: incident.status,
          } as Prisma.InputJsonValue,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Incident",
          entityId: incident.id,
          action: "ALERT_RECOVERED",
          after: { alertId: alert.id, alertType: alert.alertType, severity: alert.severity },
          correlationId: actor.correlationId,
        },
        tx,
      );
    });

    try {
      let userIds: string[] = [];
      if (incident.ownerUserId) {
        userIds = [incident.ownerUserId];
      } else if (incident.ownerGroupId) {
        const members = await this.prisma.supportGroupMember.findMany({
          where: { groupId: incident.ownerGroupId },
          select: { userId: true },
        });
        userIds = members.map((m) => m.userId);
      } else {
        const desk = await this.prisma.user.findMany({
          where: { isActive: true, role: UserRole.SERVICE_DESK_NOC },
          select: { id: true },
        });
        userIds = desk.map((u) => u.id);
      }
      await this.inbox.notifyUsers({
        userIds,
        kind: InAppNotificationKind.ALERT_RECOVERED,
        title: `Monitoring reports ${alert.alertType} cleared on ${incident.incidentNo}`,
        body: "Confirm the fix and resolve the ticket if nothing else is wrong.",
        entityType: "INCIDENT",
        entityId: incident.id,
        level: levelForPriority(incident.priority),
        dedupeKey: `alert-recovered:${alert.id}`,
      });
    } catch (err) {
      this.logger.warn(
        `alert-recovered notification skipped for incident ${incident.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async notifyAlertRecoveredEmail(
    incident: Incident,
    alert: { id: string; alertType: string; severity: string },
    recoveredAt: Date,
  ): Promise<void> {
    try {
      if (!incident.ownerUserId) {
        return;
      }
      const owner = await this.prisma.user.findUnique({ where: { id: incident.ownerUserId } });
      if (!owner?.email) {
        return;
      }
      await this.notifications.enqueue(
        {
          event: {
            kind: "INCIDENT_ALERT_RECOVERED_AFTER_RESOLVE",
            entity: await ticketEntityRef(this.prisma, incident),
            alertType: alert.alertType,
            severity: alert.severity,
            recoveredAt: recoveredAt.toISOString(),
          },
          recipients: { to: [{ name: owner.displayName, email: owner.email }] },
        },
        // Exactly 2 colons (3 parts split on ":") — BullMQ rejects a custom
        // jobId with any other colon count (job.js's legacy repeatable-job
        // compat check), so this must NOT also fold in a colon-bearing ISO
        // timestamp the way the timeline event's own payload does. Keyed on
        // the alert row's id, not alertType, so a genuinely later, distinct
        // recovery for the same alert type still gets its own notification.
        `INCIDENT_ALERT_RECOVERED_AFTER_RESOLVE:${incident.id}:${alert.id}`,
      );
    } catch (err) {
      this.logger.warn(
        `alert-recovered-after-resolve notification skipped for incident ${incident.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // --- Comments + timeline reads (spec §19, §29) -----------------------

  async createComment(
    incidentId: string,
    dto: CreateIncidentCommentDto,
    actor: ActorContext,
    user: AuthenticatedUser,
  ): Promise<IncidentComment> {
    const incident = await this.findOneScoped(incidentId, user);
    // A customer can never post an internal note, regardless of what the
    // request body says — the frontend doesn't offer the toggle, but the
    // backend is the actual guarantee (CLAUDE.md: never trust the client).
    const isInternal =
      user.role === UserRole.CLIENT_MANAGER_VIEWER ? false : (dto.isInternal ?? true);

    const comment = await this.prisma.$transaction(async (tx) => {
      const comment = await tx.incidentComment.create({
        data: {
          incidentId,
          authorId: actor.actorId,
          body: dto.body,
          isInternal,
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId,
          eventType: "COMMENT",
          actorId: actor.actorId,
          payload: {
            commentId: comment.id,
            isInternal: comment.isInternal,
          } as Prisma.InputJsonValue,
        },
      });

      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "IncidentComment",
          entityId: comment.id,
          action: "CREATE",
          after: comment,
          correlationId: actor.correlationId,
        },
        tx,
      );

      return comment;
    });

    await this.notifyComment(incident, comment, user);
    return comment;
  }

  /**
   * Spec §19: "separate internal engineer notes from customer-visible
   * comments." CLIENT_MANAGER_VIEWER never sees isInternal rows; every other
   * role (including AUDITOR_READ_ONLY, which needs full evidence per §4)
   * sees everything.
   */
  async listComments(incidentId: string, user: AuthenticatedUser): Promise<CommentView[]> {
    await this.findOneScoped(incidentId, user);
    const comments = await this.prisma.incidentComment.findMany({
      where: {
        incidentId,
        ...(user.role === UserRole.CLIENT_MANAGER_VIEWER ? { isInternal: false } : {}),
      },
      orderBy: { createdAt: "asc" },
      include: {
        attachments: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
      },
    });
    // Both sides of the conversation see who wrote each message, by name.
    const authors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(comments.map((c) => c.authorId))] } },
      select: { id: true, displayName: true, role: true },
    });
    const byId = new Map(authors.map((a) => [a.id, a]));
    // The query already leaves internal notes out for a customer; this is
    // the belt to that brace.
    const visible =
      user.role === UserRole.CLIENT_MANAGER_VIEWER
        ? comments.filter((c) => !c.isInternal)
        : comments;
    return visible.map((c) => ({
      ...c,
      author: byId.get(c.authorId) ?? { id: c.authorId, displayName: "Unknown user", role: null },
    }));
  }

  /**
   * Powers the "Sample Incident Page" (spec §29) ordered timeline. A
   * customer only gets the status moves (from/to and when, not the staff
   * reason) and their own fix feedback: worklogs, routing, SLA and internal
   * comment events are staff-only, same as internal comments.
   */
  async listEvents(incidentId: string, user: AuthenticatedUser): Promise<IncidentEvent[]> {
    await this.findOneScoped(incidentId, user);
    const events = await this.prisma.incidentEvent.findMany({
      where: { incidentId },
      orderBy: { createdAt: "asc" },
    });
    if (user.role !== UserRole.CLIENT_MANAGER_VIEWER) {
      return events;
    }
    return events.flatMap((e): IncidentEvent[] => {
      const payload = (e.payload ?? {}) as Prisma.JsonObject;
      if (e.eventType === "STATUS_CHANGE") {
        return [{ ...e, actorId: null, payload: { from: payload.from, to: payload.to } }];
      }
      if (e.eventType === "CUSTOMER_FEEDBACK") {
        return [{ ...e, payload: { outcome: payload.outcome } }];
      }
      return [];
    });
  }

  /** SLA state for this incident's header/countdown (spec §29, §10.8). */
  async findSlaState(incidentId: string, user: AuthenticatedUser) {
    await this.findOneScoped(incidentId, user);
    return this.slaService.findForIncident(incidentId);
  }

  // --- Attachments (spec §17, §29) -------------------------------------
  //
  // No dedicated module owns attachments (CLAUDE.md's ownership table has
  // no "attachments" row) — the Attachment model's polymorphic
  // entityType/entityId design means each owning module handles its own
  // entity's attachments. This sprint only wires up entityType "INCIDENT".

  async uploadAttachment(
    incidentId: string,
    file: UploadedAttachmentFile,
    actor: ActorContext,
    user: AuthenticatedUser,
    commentId?: string,
  ): Promise<Attachment> {
    if (!file) {
      throw new BadRequestException("No file was sent");
    }
    try {
      const incident = await this.findOneScoped(incidentId, user);
      file.originalname = uploadFileName(file.originalname);
      // A file sent with a message: only onto your own message on this ticket.
      if (commentId) {
        const comment = await this.prisma.incidentComment.findUnique({ where: { id: commentId } });
        if (!comment || comment.incidentId !== incidentId) {
          throw new BadRequestException("That message isn't on this ticket");
        }
        if (comment.authorId !== actor.actorId) {
          throw new ForbiddenException("You can only attach files to your own messages");
        }
      }
      const attachment = await this.storeAttachment(incidentId, file, actor, commentId);
      // A file sent with a message is part of that message, which already
      // had its email; a file added on its own gets one. Files outside a
      // message are visible to the client, so this goes to everyone.
      if (!commentId) {
        await this.mailTicket(
          incident,
          { kind: "INCIDENT_ATTACHMENT_ADDED", fileName: file.originalname },
          { userId: actor.actorId },
        );
      }
      return attachment;
    } finally {
      // The temp file multer streamed the upload into is ours to remove,
      // whether the upload was accepted or not.
      if (file.path) await unlink(file.path).catch(() => undefined);
    }
  }

  private async storeAttachment(
    incidentId: string,
    file: UploadedAttachmentFile,
    actor: ActorContext,
    commentId: string | undefined,
  ): Promise<Attachment> {
    if (!isAllowedAttachment(file.mimetype, file.originalname)) {
      throw new BadRequestException(`Content type ${file.mimetype} is not allowed`);
    }
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new BadRequestException(
        `File exceeds the ${MAX_ATTACHMENT_SIZE_BYTES} byte size limit`,
      );
    }

    const sha256 = await sha256Of(file);
    const objectKey = `incidents/${incidentId}/${randomUUID()}-${file.originalname}`;

    // Uploaded before the DB transaction starts, not inside it — an S3 PUT
    // isn't rollback-able the way a DB write is. If the DB write then
    // fails, the object is orphaned in storage rather than a row
    // referencing a key that was never actually written.
    await this.storageService.putObject(
      objectKey,
      file.path ? createReadStream(file.path) : (file.buffer ?? Buffer.alloc(0)),
      file.mimetype,
      file.size,
    );

    return this.prisma.$transaction(async (tx) => {
      const attachment = await tx.attachment.create({
        data: {
          entityType: "INCIDENT",
          entityId: incidentId,
          objectKey,
          contentType: file.mimetype,
          sizeBytes: file.size,
          sha256,
          uploadedById: actor.actorId,
          commentId,
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId,
          eventType: "ATTACHMENT",
          actorId: actor.actorId,
          payload: {
            attachmentId: attachment.id,
            contentType: attachment.contentType,
            sizeBytes: attachment.sizeBytes,
            ...(commentId ? { commentId } : {}),
          } as Prisma.InputJsonValue,
        },
      });

      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Attachment",
          entityId: attachment.id,
          action: "CREATE",
          after: attachment,
          correlationId: actor.correlationId,
        },
        tx,
      );

      return attachment;
    });
  }

  async listAttachments(incidentId: string, user: AuthenticatedUser): Promise<Attachment[]> {
    await this.findOneScoped(incidentId, user);
    return this.prisma.attachment.findMany({
      where: {
        entityType: "INCIDENT",
        entityId: incidentId,
        deletedAt: null,
        ...this.customerAttachmentFilter(user),
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /** A file sent with an internal note is as staff-only as the note. */
  private customerAttachmentFilter(user: AuthenticatedUser): Prisma.AttachmentWhereInput {
    return user.role === UserRole.CLIENT_MANAGER_VIEWER
      ? { OR: [{ commentId: null }, { comment: { isInternal: false } }] }
      : {};
  }

  /** Short-lived signed URL, not a proxied stream or a public object (spec §17). */
  async getAttachmentDownloadUrl(
    incidentId: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ): Promise<{ url: string }> {
    await this.findOneScoped(incidentId, user);
    const attachment = await this.findLiveAttachment(incidentId, attachmentId, user);
    const url = await this.storageService.getSignedDownloadUrl(attachment.objectKey);
    return { url };
  }

  private async findLiveAttachment(
    incidentId: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ): Promise<Attachment> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    // A file sent with an internal note doesn't exist as far as a customer knows.
    const hiddenFromCustomer =
      attachment?.commentId && user.role === UserRole.CLIENT_MANAGER_VIEWER
        ? (await this.prisma.incidentComment.findUnique({ where: { id: attachment.commentId } }))
            ?.isInternal !== false
        : false;
    if (
      !attachment ||
      hiddenFromCustomer ||
      attachment.entityType !== "INCIDENT" ||
      attachment.entityId !== incidentId ||
      attachment.deletedAt !== null
    ) {
      throw new NotFoundException(`Attachment ${attachmentId} not found on this incident`);
    }
    return attachment;
  }

  /**
   * Soft delete only -- the row and the S3 object both stay (spec's
   * audit-everything rule: a removed attachment must still be
   * reconstructable, not gone without a trace). Just stops appearing in
   * listAttachments and becomes undownloadable.
   */
  async deleteAttachment(
    incidentId: string,
    attachmentId: string,
    actor: ActorContext,
    user: AuthenticatedUser,
  ): Promise<void> {
    const incident = await this.findOneScoped(incidentId, user);
    const before = await this.findLiveAttachment(incidentId, attachmentId, user);
    // A customer can take back their own evidence, never the desk's.
    if (user.role === UserRole.CLIENT_MANAGER_VIEWER && before.uploadedById !== user.id) {
      throw new ForbiddenException("You can only remove files you attached yourself");
    }

    await this.prisma.$transaction(async (tx) => {
      const after = await tx.attachment.update({
        where: { id: attachmentId },
        data: { deletedAt: new Date(), deletedById: actor.actorId },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId,
          eventType: "ATTACHMENT_REMOVED",
          actorId: actor.actorId,
          payload: {
            attachmentId,
            contentType: before.contentType,
          } as Prisma.InputJsonValue,
        },
      });

      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Attachment",
          entityId: attachmentId,
          action: "DELETE",
          before,
          after,
          correlationId: actor.correlationId,
        },
        tx,
      );
    });

    // A file from an internal note was never visible to the client, so
    // its removal is staff news only.
    const internal = before.commentId
      ? (await this.prisma.incidentComment.findUnique({ where: { id: before.commentId } }))
          ?.isInternal !== false
      : false;
    const fileName = (before.objectKey.split("/").pop() ?? before.objectKey).replace(
      /^[0-9a-f-]{36}-/,
      "",
    );
    await this.mailTicket(
      incident,
      { kind: "INCIDENT_UPDATED", changes: [`Removed file ${fileName}`] },
      { userId: actor.actorId },
      { internal },
    );
  }

  // --- Stakeholder notifications (best-effort) --------------------------
  //
  // Same shape as VendorsService.notifyLinkedIncidentOwner: resolve
  // recipient email(s) after the mutation has already committed and been
  // audited, enqueue via NotificationsPublisher, swallow any failure. A
  // missing/unreachable notifications queue must never fail the request
  // that triggered it — the domain write already succeeded.

  /**
   * Tell the service desk/NOC roster (bell) the moment a ticket is raised,
   * and send the ticket's first email (see mailTicket): to the assignee and
   * group it landed with, else the service desk; the reporter and CC list
   * on Cc. Called from create() (and so from createFromCustomer() too,
   * which calls create() internally) — one insertion point covers both
   * staff-created and customer self-service tickets.
   */
  private async notifyServiceDeskOfNewIncident(
    incident: Incident,
    actorUserId: string,
  ): Promise<void> {
    try {
      const roster = await this.prisma.user.findMany({
        where: { isActive: true, role: UserRole.SERVICE_DESK_NOC },
        select: { id: true },
      });
      await this.inbox.notifyUsers({
        userIds: roster.map((u) => u.id),
        actorUserId,
        kind: InAppNotificationKind.INCIDENT_CREATED,
        title: `New ticket ${incident.incidentNo} (${incident.priority})`,
        body: incident.shortDescription,
        entityType: "INCIDENT",
        entityId: incident.id,
        level: levelForPriority(incident.priority),
        dedupeKey: `created:${incident.id}`,
      });
    } catch (err) {
      this.logger.warn(
        `new-incident service-desk notification skipped for incident ${incident.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    await this.mailTicket(
      incident,
      { kind: "INCIDENT_CREATED", description: incident.description ?? undefined },
      { userId: actorUserId },
      { jobId: `INCIDENT_CREATED:${incident.id}:new` },
    );
  }

  /** The (re)assigned owner's bell. Its email is the one the operation that
   *  assigned it sends (create, edit, status change), never a second one. */
  private async notifyAssignment(
    incident: Incident,
    ownerUserId: string,
    actorUserId?: string,
  ): Promise<void> {
    try {
      // The key includes updatedAt so that a later re-assignment back to
      // the same engineer shows up again.
      await this.inbox.notifyUsers({
        userIds: [ownerUserId],
        actorUserId,
        kind: InAppNotificationKind.INCIDENT_ASSIGNED,
        title: `${incident.incidentNo} assigned to you`,
        body: incident.shortDescription,
        entityType: "INCIDENT",
        entityId: incident.id,
        level: levelForPriority(incident.priority),
        dedupeKey: `assigned:${incident.id}:${ownerUserId}:${incident.updatedAt.getTime()}`,
      });
    } catch (err) {
      this.logger.warn(
        `assignment notification skipped for incident ${incident.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Every group member's bell when a ticket lands in their queue with no
   *  individual owner yet — otherwise a group assignment satisfies the
   *  NEW -> ASSIGNED gate but pages nobody. The email is the operation's
   *  own (the group is on its To line). */
  private async notifyGroupAssignment(
    incident: Incident,
    ownerGroupId: string,
    actorUserId?: string,
  ): Promise<void> {
    try {
      const group = await this.prisma.supportGroup.findUnique({
        where: { id: ownerGroupId },
        include: { members: true },
      });
      if (!group) {
        return;
      }
      await this.inbox.notifyUsers({
        userIds: group.members.map((m) => m.userId),
        actorUserId,
        kind: InAppNotificationKind.INCIDENT_GROUP_ASSIGNED,
        title: `${incident.incidentNo} assigned to ${group.name}`,
        body: incident.shortDescription,
        entityType: "INCIDENT",
        entityId: incident.id,
        level: levelForPriority(incident.priority),
        dedupeKey: `group:${incident.id}:${ownerGroupId}:${incident.updatedAt.getTime()}`,
      });
    } catch (err) {
      this.logger.warn(
        `group-assignment notification skipped for incident ${incident.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Bells for the owner and the reporter, and one email to everyone on the
   * ticket. The email shows the status as the ticket does and leaves out
   * the transition reason, a staff field the client never sees (anything
   * meant for them goes in a customer-visible reply). `actorUserId` unset
   * means skill-based routing moved it.
   */
  private async notifyStatusChange(
    before: Incident,
    after: Incident,
    reason?: string,
    actorUserId?: string,
  ): Promise<void> {
    try {
      const dedupeKey = `status:${after.id}:${after.status}:${after.updatedAt.getTime()}`;
      await this.inbox.notifyUsers({
        userIds: [after.ownerUserId],
        actorUserId,
        kind: InAppNotificationKind.INCIDENT_STATUS_CHANGED,
        title: `${after.incidentNo}: ${before.status} → ${after.status}`,
        body: reason ?? after.shortDescription,
        entityType: "INCIDENT",
        entityId: after.id,
        level: levelForPriority(after.priority),
        dedupeKey,
      });
      await this.inbox.notifyUsers({
        userIds: [after.reportedByUserId],
        actorUserId,
        kind: InAppNotificationKind.INCIDENT_STATUS_CHANGED,
        title: `${after.incidentNo}: ${CUSTOMER_STATUS_LABEL[after.status]}`,
        body: after.shortDescription,
        entityType: "INCIDENT",
        entityId: after.id,
        level: levelForPriority(after.priority),
        dedupeKey,
      });
    } catch (err) {
      this.logger.warn(
        `status-change notification skipped for incident ${after.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Two states can share a label (Acknowledged and In Progress both show
    // as "In Progress"); then say which, rather than "X → X".
    let from = ticketStatusLabel(before.status);
    let to = ticketStatusLabel(after.status);
    if (from === to) {
      from = rawStatusLabel(before.status);
      to = rawStatusLabel(after.status);
    }
    await this.mailTicket(
      after,
      { kind: "INCIDENT_STATUS_CHANGED", from, to },
      actorUserId ? { userId: actorUserId } : { name: "Skill-based routing" },
    );
  }

  /**
   * Bell for the other side of the conversation, and one email: a reply
   * the client can see goes to everyone on the ticket; an internal note
   * only to the assignee and group. A customer's reply reaches whoever is
   * handling the ticket (see supportRecipientIds), even unassigned.
   */
  private async notifyComment(
    incident: Incident,
    comment: IncidentComment,
    author: AuthenticatedUser,
  ): Promise<void> {
    if (author.role === UserRole.CLIENT_MANAGER_VIEWER) {
      await this.notifyCustomerReply(incident, comment, author);
    } else if (!comment.isInternal && incident.reportedByUserId) {
      try {
        await this.inbox.notifyUsers({
          userIds: [incident.reportedByUserId],
          actorUserId: author.id,
          kind: InAppNotificationKind.INCIDENT_COMMENT_ADDED,
          title: `New reply from the service desk on ${incident.incidentNo}`,
          body: comment.body.length > 200 ? `${comment.body.slice(0, 199)}…` : comment.body,
          entityType: "INCIDENT",
          entityId: incident.id,
          level: levelForPriority(incident.priority),
          dedupeKey: `comment:${comment.id}`,
        });
      } catch (err) {
        this.logger.warn(
          `comment notification skipped for incident ${incident.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await this.mailTicket(
      incident,
      {
        kind: "INCIDENT_COMMENT_ADDED",
        author: { email: author.email },
        body: comment.body,
        internal: comment.isInternal,
      },
      { userId: author.id },
      { internal: comment.isInternal },
    );
  }

  private async notifyCustomerReply(
    incident: Incident,
    comment: IncidentComment,
    author: AuthenticatedUser,
  ): Promise<void> {
    try {
      const waiting = incident.status === IncidentStatus.PENDING_CUSTOMER;
      await this.inbox.notifyUsers({
        userIds: await this.supportRecipientIds(incident),
        actorUserId: author.id,
        kind: InAppNotificationKind.CUSTOMER_RESPONDED,
        title: waiting
          ? `Customer replied on ${incident.incidentNo}: ready to resume`
          : `Customer replied on ${incident.incidentNo}`,
        body: comment.body.length > 200 ? `${comment.body.slice(0, 199)}…` : comment.body,
        entityType: "INCIDENT",
        entityId: incident.id,
        level: levelForPriority(incident.priority),
        dedupeKey: `comment:${comment.id}`,
      });
    } catch (err) {
      this.logger.warn(
        `customer-reply notification skipped for incident ${incident.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Who hears from the customer on this ticket: the assigned engineer, else
   * the owning group's members, else the service desk. The service desk is
   * added whenever `includeDesk` is set, since some follow-ups (closing a
   * confirmed fix) are theirs whoever owns the ticket.
   */
  async supportRecipientIds(incident: Incident, includeDesk = false): Promise<string[]> {
    const ids: string[] = [];
    if (incident.ownerUserId) {
      ids.push(incident.ownerUserId);
    } else if (incident.ownerGroupId) {
      const members = await this.prisma.supportGroupMember.findMany({
        where: { groupId: incident.ownerGroupId },
        select: { userId: true },
      });
      ids.push(...members.map((m) => m.userId));
    }
    if (includeDesk || ids.length === 0) {
      const desk = await this.prisma.user.findMany({
        where: { isActive: true, role: UserRole.SERVICE_DESK_NOC },
        select: { id: true },
      });
      ids.push(...desk.map((u) => u.id));
    }
    return ids;
  }
}
