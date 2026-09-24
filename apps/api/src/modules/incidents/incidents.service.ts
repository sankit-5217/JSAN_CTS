import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { createHash, randomUUID } from "crypto";
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
import type { Party } from "@cts-dc-opsdesk/email-adapter";
import { NotificationsPublisher } from "../../common/notifications/notifications.publisher";
import { StorageService } from "../../common/storage/storage.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { Paginated } from "../../common/types/paginated.type";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthzService } from "../auth/authz.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { InboxService } from "../inbox/inbox.service";
import { SlaService } from "../sla/sla.service";
import {
  ALLOWED_ATTACHMENT_CONTENT_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "./attachment.constants";
import { INCIDENT_CREATED_EVENT, IncidentCreatedEvent } from "./incident-events";
import { CreateIncidentAsCustomerDto } from "./dto/create-incident-as-customer.dto";
import { CreateIncidentCommentDto } from "./dto/create-incident-comment.dto";
import { CreateIncidentDto } from "./dto/create-incident.dto";
import { ListIncidentsQueryDto } from "./dto/list-incidents-query.dto";
import { TransitionIncidentDto } from "./dto/transition-incident.dto";
import { UpdateIncidentDto } from "./dto/update-incident.dto";
import {
  findTransitionRule,
  INCIDENT_ROUTING_ROLES,
  isOwnerOrElevated,
  OPEN_STATUSES,
  TRANSITION_RULES,
} from "./incident-transitions";
import type { TransitionDto } from "./incident-transitions";

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

/** Minimal shape of what NestJS's FileInterceptor hands us (multer.File). */
export interface UploadedAttachmentFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
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

    let siteFilter: string[] | undefined;
    if (accessibleSiteIds) {
      siteFilter =
        query.siteId && accessibleSiteIds.includes(query.siteId)
          ? [query.siteId]
          : accessibleSiteIds;
    } else if (query.siteId) {
      siteFilter = [query.siteId];
    }

    const where: Prisma.IncidentWhereInput = {
      siteId: siteFilter ? { in: siteFilter } : undefined,
      // Same reasoning as findOneScoped: site access is a staff-shaped
      // grant, not "this is my ticket." Forced, never client-settable —
      // there's no ?reportedByUserId= query param a customer could spoof
      // even if they tried; this branches on the caller's own role only.
      reportedByUserId: user.role === UserRole.CLIENT_MANAGER_VIEWER ? user.id : undefined,
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
    await this.assertSiteAccess(user, incident.siteId);
    // Site access alone is staff-shaped scoping — every internal role at a
    // site can see every incident there. A CLIENT_MANAGER_VIEWER isn't staff:
    // the client portal's entire promise is "track your own ticket," not
    // "see every ticket your site has ever raised" (which would leak other
    // reporters' incidents, including ones with no connection to this
    // caller at all — see reportedByUserId, added for exactly this reason).
    if (user.role === UserRole.CLIENT_MANAGER_VIEWER && incident.reportedByUserId !== user.id) {
      throw new ForbiddenException("You do not have access to this incident");
    }
    return incident;
  }

  /** userId -> number of open incidents they currently own, across all
   * sites (an engineer's workload doesn't stop at one site). Engineers with
   * no open incidents are simply absent from the map. Used by the routing
   * module's least-loaded tie-break. */
  async countOpenOwnedBy(userIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (userIds.length === 0) {
      return counts;
    }
    const rows = await this.prisma.incident.groupBy({
      by: ["ownerUserId"],
      where: { ownerUserId: { in: userIds }, status: { in: OPEN_STATUSES } },
      _count: { _all: true },
    });
    for (const row of rows) {
      if (row.ownerUserId) {
        counts.set(row.ownerUserId, row._count._all);
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
  // request body input.
  async create(dto: CreateIncidentDto, actor: ActorContext, reportedByUserId?: string) {
    const incident = await this.prisma.$transaction(async (tx) => {
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
          reportedByUserId,
        },
      });
      await tx.incidentEvent.create({
        data: {
          incidentId: incident.id,
          eventType: "CREATED",
          actorId: actor.actorId,
          payload: { status: incident.status } as Prisma.InputJsonValue,
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
    });

    await this.notifyServiceDeskOfNewIncident(incident, actor.actorId);
    const createdEvent: IncidentCreatedEvent = {
      incidentId: incident.id,
      siteId: incident.siteId,
      correlationId: actor.correlationId,
    };
    this.events.emit(INCIDENT_CREATED_EVENT, createdEvent);
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
  async createFromCustomer(
    dto: CreateIncidentAsCustomerDto,
    actor: ActorContext,
    user: AuthenticatedUser,
  ): Promise<Incident> {
    await this.assertSiteAccess(user, dto.siteId);

    const incident = await this.create(
      {
        siteId: dto.siteId,
        category: dto.category,
        impact: "MEDIUM",
        urgency: "MEDIUM",
        priority: Priority.P3,
        shortDescription: dto.shortDescription,
      },
      actor,
      user.id,
    );

    if (dto.details) {
      await this.createComment(incident.id, { body: dto.details, isInternal: false }, actor, user);
    }

    return incident;
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

    const after = await this.prisma.$transaction(async (tx) => {
      const after = await tx.incident.update({
        where: { id },
        data: {
          shortDescription: dto.shortDescription,
          category: dto.category,
          impact: dto.impact,
          urgency: dto.urgency,
          ciId: dto.ciId,
          ownerGroupId: dto.ownerGroupId,
          ownerUserId: dto.ownerUserId,
          priority: dto.priority,
        },
      });

      if (ownerChanged) {
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

      if (priorityChanged) {
        await this.slaService.onPriorityChanged(
          tx,
          { id, siteId: before.siteId },
          after.priority,
          actor,
        );
      }

      return after;
    });

    if (ownerChanged && after.ownerUserId) {
      await this.notifyAssignment(after, after.ownerUserId, actor.actorId);
    } else if (ownerChanged && after.ownerGroupId && !after.ownerUserId) {
      await this.notifyGroupAssignment(after, after.ownerGroupId, actor.actorId);
    }

    return after;
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

    return after;
  }

  /**
   * System-initiated NEW -> ASSIGNED for skill-based auto-routing (routing
   * module, Phase 4). Not createTransition(): there's no authenticated
   * caller whose role could be checked (a customer-portal ticket's creator
   * can't assign at all) — the authorization here is the admin-enabled
   * per-site RoutingPolicy, checked by the routing module before calling.
   * Everything else matches a human assign: the same rule table's
   * validate(), a STATUS_CHANGE timeline event, an audit record (actorId
   * null — no human actor — with `source: SKILL_ROUTING` on the event), and
   * the usual status/assignment notifications. NEW -> ASSIGNED has no SLA
   * hook, same as the human path.
   *
   * Returns null (and changes nothing) when the incident is no longer NEW
   * and unowned — e.g. the desk assigned it first. The conditional
   * updateMany makes that check atomic with the write.
   */
  async autoAssign(
    id: string,
    ownerUserId: string,
    correlationId?: string,
  ): Promise<Incident | null> {
    const incident = await this.findOne(id);
    if (incident.status !== IncidentStatus.NEW || incident.ownerUserId || incident.ownerGroupId) {
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
        where: { id, status: IncidentStatus.NEW, ownerUserId: null, ownerGroupId: null },
        data: { status: IncidentStatus.ASSIGNED, ownerUserId },
      });
      if (count === 0) {
        return null;
      }
      const after = await tx.incident.findUniqueOrThrow({ where: { id } });

      await tx.incidentEvent.create({
        data: {
          incidentId: id,
          eventType: "STATUS_CHANGE",
          actorId: null,
          payload: {
            from: incident.status,
            to: after.status,
            ownerUserId,
            source: "SKILL_ROUTING",
          } as Prisma.InputJsonValue,
        },
      });
      await this.auditService.record(
        {
          actorId: null,
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
    await this.notifyStatusChange(incident, after, "Auto-assigned by skill-based routing");
    await this.notifyAssignment(after, ownerUserId);
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
  ];

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
    alert: {
      id: string;
      alertType: string;
      severity: string;
      source: string;
      fingerprint: string;
    },
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

    await this.prisma.$transaction(async (tx) => {
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
          },
          correlationId: actor.correlationId,
        },
        tx,
      );
    });

    return { linked: true };
  }

  /**
   * Recovery counterpart to `linkAlert` — called when an already-linked alert
   * genuinely clears (monitoring reports RECOVERED). If the ticket is still
   * open this is just the expected order (condition cleared, engineer
   * resolves next) and needs no extra signal. If the ticket was already
   * RESOLVED/CLOSED — most notably via the open-alert override in
   * `createTransition()` — this closes the loop: writes an
   * `ALERT_RECOVERED_AFTER_RESOLVE` timeline event + audit record, and
   * best-effort emails the owner that the real problem is now actually fixed.
   * No-ops (returns `{ notified: false }`) when the incident is still open,
   * unknown, or has no owner to tell.
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
      return { notified: false };
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
            entity: this.toEntityRef(incident),
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
  async listComments(incidentId: string, user: AuthenticatedUser): Promise<IncidentComment[]> {
    await this.findOneScoped(incidentId, user);
    const comments = await this.prisma.incidentComment.findMany({
      where: { incidentId },
      orderBy: { createdAt: "asc" },
    });
    if (user.role === UserRole.CLIENT_MANAGER_VIEWER) {
      return comments.filter((comment) => !comment.isInternal);
    }
    return comments;
  }

  /** Powers the "Sample Incident Page" (spec §29) ordered timeline. */
  async listEvents(incidentId: string, user: AuthenticatedUser): Promise<IncidentEvent[]> {
    await this.findOneScoped(incidentId, user);
    return this.prisma.incidentEvent.findMany({
      where: { incidentId },
      orderBy: { createdAt: "asc" },
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
  ): Promise<Attachment> {
    await this.findOneScoped(incidentId, user);

    if (!ALLOWED_ATTACHMENT_CONTENT_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(`Content type ${file.mimetype} is not allowed`);
    }
    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new BadRequestException(
        `File exceeds the ${MAX_ATTACHMENT_SIZE_BYTES} byte size limit`,
      );
    }

    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const objectKey = `incidents/${incidentId}/${randomUUID()}-${file.originalname}`;

    // Uploaded before the DB transaction starts, not inside it — an S3 PUT
    // isn't rollback-able the way a DB write is. If the DB write then
    // fails, the object is orphaned in storage rather than a row
    // referencing a key that was never actually written.
    await this.storageService.putObject(objectKey, file.buffer, file.mimetype);

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
      where: { entityType: "INCIDENT", entityId: incidentId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Short-lived signed URL, not a proxied stream or a public object (spec §17). */
  async getAttachmentDownloadUrl(
    incidentId: string,
    attachmentId: string,
    user: AuthenticatedUser,
  ): Promise<{ url: string }> {
    await this.findOneScoped(incidentId, user);
    const attachment = await this.findLiveAttachment(incidentId, attachmentId);
    const url = await this.storageService.getSignedDownloadUrl(attachment.objectKey);
    return { url };
  }

  private async findLiveAttachment(incidentId: string, attachmentId: string): Promise<Attachment> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (
      !attachment ||
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
    await this.findOneScoped(incidentId, user);
    const before = await this.findLiveAttachment(incidentId, attachmentId);

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
  }

  // --- Stakeholder notifications (best-effort) --------------------------
  //
  // Same shape as VendorsService.notifyLinkedIncidentOwner: resolve
  // recipient email(s) after the mutation has already committed and been
  // audited, enqueue via NotificationsPublisher, swallow any failure. A
  // missing/unreachable notifications queue must never fail the request
  // that triggered it — the domain write already succeeded.

  private toEntityRef(incident: Pick<Incident, "incidentNo" | "shortDescription" | "priority">) {
    return {
      key: incident.incidentNo,
      title: incident.shortDescription,
      priority: incident.priority,
    };
  }

  private partyFor(
    users: { id: string; email: string; displayName: string }[],
    id: string | null,
  ): Party | undefined {
    const match = id ? users.find((u) => u.id === id) : undefined;
    return match?.email ? { name: match.displayName, email: match.email } : undefined;
  }

  /**
   * Tell the service desk/NOC roster the moment a ticket is raised. Before
   * this, the first notification any incident ever got was on assignment —
   * a brand-new ticket could sit unnoticed in the queue until someone
   * happened to look. Called from create() (and so from createFromCustomer()
   * too, which calls create() internally) — one insertion point covers both
   * staff-created and customer self-service tickets. Mirrors
   * AlertsService.notifyNocOfCriticalAlert's role-roster pattern; there was
   * no equivalent "page the desk" helper in this module yet.
   */
  private async notifyServiceDeskOfNewIncident(
    incident: Incident,
    actorUserId: string,
  ): Promise<void> {
    try {
      const roster = await this.prisma.user.findMany({
        where: { isActive: true, role: UserRole.SERVICE_DESK_NOC },
        select: { id: true, email: true, displayName: true },
      });
      await this.inbox.notifyUsers({
        userIds: roster.map((u) => u.id),
        actorUserId,
        kind: InAppNotificationKind.INCIDENT_CREATED,
        title: `New ticket ${incident.incidentNo} (${incident.priority})`,
        body: incident.shortDescription,
        entityType: "INCIDENT",
        entityId: incident.id,
        dedupeKey: `created:${incident.id}`,
      });
      const to = roster
        .filter((u) => u.email)
        .map((u) => ({ name: u.displayName, email: u.email }));
      if (to.length === 0) {
        return;
      }
      let reporter: Party | undefined;
      if (incident.reportedByUserId) {
        const reportedBy = await this.prisma.user.findUnique({
          where: { id: incident.reportedByUserId },
        });
        reporter = reportedBy?.email
          ? { name: reportedBy.displayName, email: reportedBy.email }
          : undefined;
      }
      await this.notifications.enqueue(
        {
          event: { kind: "INCIDENT_CREATED", entity: this.toEntityRef(incident), reporter },
          recipients: { to },
        },
        `INCIDENT_CREATED:${incident.id}:new`,
      );
    } catch (err) {
      this.logger.warn(
        `new-incident service-desk notification skipped for incident ${incident.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Tell the (re)assigned owner. Called from createTransition (assigning as
   *  part of a status move) and update() (a plain reassignment via PATCH). */
  private async notifyAssignment(
    incident: Incident,
    ownerUserId: string,
    actorUserId?: string,
  ): Promise<void> {
    try {
      // The in-app key includes updatedAt so that a later re-assignment back
      // to the same engineer shows up again. The email's jobId intentionally
      // doesn't include it.
      await this.inbox.notifyUsers({
        userIds: [ownerUserId],
        actorUserId,
        kind: InAppNotificationKind.INCIDENT_ASSIGNED,
        title: `${incident.incidentNo} assigned to you`,
        body: incident.shortDescription,
        entityType: "INCIDENT",
        entityId: incident.id,
        dedupeKey: `assigned:${incident.id}:${ownerUserId}:${incident.updatedAt.getTime()}`,
      });
      const assignee = await this.prisma.user.findUnique({ where: { id: ownerUserId } });
      if (!assignee?.email) {
        return;
      }
      const party: Party = { name: assignee.displayName, email: assignee.email };
      await this.notifications.enqueue(
        {
          event: { kind: "INCIDENT_ASSIGNED", entity: this.toEntityRef(incident), assignee: party },
          recipients: { to: [party] },
        },
        `INCIDENT_ASSIGNED:${incident.id}:${ownerUserId}`,
      );
    } catch (err) {
      this.logger.warn(
        `assignment notification skipped for incident ${incident.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Tell every member of a support group when a ticket lands in their
   *  queue with no individual owner yet — otherwise a group assignment
   *  satisfies the NEW -> ASSIGNED gate but pages nobody. Only called when
   *  ownerUserId is unset; once someone claims it, notifyAssignment takes
   *  over. */
  private async notifyGroupAssignment(
    incident: Incident,
    ownerGroupId: string,
    actorUserId?: string,
  ): Promise<void> {
    try {
      const group = await this.prisma.supportGroup.findUnique({
        where: { id: ownerGroupId },
        include: { members: { include: { user: true } } },
      });
      if (!group) {
        return;
      }
      await this.inbox.notifyUsers({
        userIds: group.members.map((m) => m.user.id),
        actorUserId,
        kind: InAppNotificationKind.INCIDENT_GROUP_ASSIGNED,
        title: `${incident.incidentNo} assigned to ${group.name}`,
        body: incident.shortDescription,
        entityType: "INCIDENT",
        entityId: incident.id,
        dedupeKey: `group:${incident.id}:${ownerGroupId}:${incident.updatedAt.getTime()}`,
      });
      const to: Party[] = group.members
        .filter((m) => m.user.isActive && m.user.email)
        .map((m) => ({ name: m.user.displayName, email: m.user.email }));
      if (to.length === 0) {
        return;
      }
      await this.notifications.enqueue(
        {
          event: {
            kind: "INCIDENT_GROUP_ASSIGNED",
            entity: this.toEntityRef(incident),
            group: { name: group.name },
          },
          recipients: { to },
        },
        `INCIDENT_GROUP_ASSIGNED:${incident.id}:${ownerGroupId}`,
      );
    } catch (err) {
      this.logger.warn(
        `group-assignment notification skipped for incident ${incident.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Tell the owner (to) and, when this ticket came in through customer
   * self-service, cc the reporting customer on every status move — the
   * "keep the client updated, cc'd on the ticket" loop. No-ops if neither
   * has an email on file (still unassigned and not customer-reported).
   */
  private async notifyStatusChange(
    before: Incident,
    after: Incident,
    reason?: string,
    actorUserId?: string,
  ): Promise<void> {
    try {
      const ids = [after.ownerUserId, after.reportedByUserId].filter((v): v is string =>
        Boolean(v),
      );
      if (ids.length === 0) {
        return;
      }
      await this.inbox.notifyUsers({
        userIds: ids,
        actorUserId,
        kind: InAppNotificationKind.INCIDENT_STATUS_CHANGED,
        title: `${after.incidentNo}: ${before.status} → ${after.status}`,
        body: reason ?? after.shortDescription,
        entityType: "INCIDENT",
        entityId: after.id,
        dedupeKey: `status:${after.id}:${after.status}:${after.updatedAt.getTime()}`,
      });
      const users = await this.prisma.user.findMany({ where: { id: { in: ids } } });
      const owner = this.partyFor(users, after.ownerUserId);
      const customer = this.partyFor(users, after.reportedByUserId);
      const to = owner ? [owner] : customer ? [customer] : [];
      if (to.length === 0) {
        return;
      }
      await this.notifications.enqueue({
        event: {
          kind: "INCIDENT_STATUS_CHANGED",
          entity: this.toEntityRef(after),
          from: before.status,
          to: after.status,
          comment: reason,
        },
        recipients: { to, cc: owner && customer ? [customer] : undefined },
      });
    } catch (err) {
      this.logger.warn(
        `status-change notification skipped for incident ${after.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Only notifies the *other side* of the conversation: the customer
   * commenting tells the assigned engineer; an internal reply explicitly
   * marked customer-visible tells the reporting customer back. An
   * internal-only note between staff notifies no one — they already share
   * the same incident page.
   */
  private async notifyComment(
    incident: Incident,
    comment: IncidentComment,
    author: AuthenticatedUser,
  ): Promise<void> {
    try {
      const recipientId =
        author.role === UserRole.CLIENT_MANAGER_VIEWER
          ? incident.ownerUserId
          : comment.isInternal
            ? null
            : incident.reportedByUserId;
      if (!recipientId) {
        return;
      }
      await this.inbox.notifyUsers({
        userIds: [recipientId],
        actorUserId: author.id,
        kind: InAppNotificationKind.INCIDENT_COMMENT_ADDED,
        title: `New comment on ${incident.incidentNo}`,
        body: comment.body.length > 200 ? `${comment.body.slice(0, 199)}…` : comment.body,
        entityType: "INCIDENT",
        entityId: incident.id,
        dedupeKey: `comment:${comment.id}`,
      });
      const recipient = await this.prisma.user.findUnique({ where: { id: recipientId } });
      if (!recipient?.email) {
        return;
      }
      await this.notifications.enqueue({
        event: {
          kind: "INCIDENT_COMMENT_ADDED",
          entity: this.toEntityRef(incident),
          author: { email: author.email },
          body: comment.body,
        },
        recipients: { to: [{ name: recipient.displayName, email: recipient.email }] },
      });
    } catch (err) {
      this.logger.warn(
        `comment notification skipped for incident ${incident.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
