import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  InAppNotificationKind,
  Incident,
  IncidentStatus,
  Priority,
  RoutingOffer,
  RoutingOfferStatus,
  UserRole,
} from "@prisma/client";
import { NotificationsPublisher } from "../../common/notifications/notifications.publisher";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ActorContext } from "../../common/types/actor-context.type";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { InboxService } from "../inbox/inbox.service";
import {
  INCIDENT_CREATED_EVENT,
  INCIDENT_UPDATED_EVENT,
  IncidentCreatedEvent,
  IncidentUpdatedEvent,
} from "../incidents/incident-events";
import { IncidentsService } from "../incidents/incidents.service";
import { offerTimeoutFor, RoutingCandidate, RoutingService } from "./routing.service";

/** Offers the expiry sweep handles per run; the rest wait a minute. */
const EXPIRY_BATCH_SIZE = 100;

export interface RoutingOfferView {
  id: string;
  userId: string;
  displayName: string;
  status: RoutingOfferStatus;
  expiresAt: string;
  respondedAt: string | null;
  declineReason: string | null;
  createdAt: string;
}

export interface IncidentRoutingOffers {
  incidentId: string;
  pending: RoutingOfferView | null;
  /** Every offer for the incident, oldest first (includes the pending one). */
  history: RoutingOfferView[];
}

type OfferWithUser = RoutingOffer & { user: { displayName: string; email: string } };

/**
 * Offer/accept routing. When a site's policy is on, a new incident is
 * offered to the top-ranked engineer (RoutingService.rank). The incident
 * stays NEW and unowned while the offer is open. The engineer accepts
 * (-> ASSIGNED to them via IncidentsService.autoAssign) or declines; if
 * they decline or the offer expires, it goes to the next-ranked engineer
 * who hasn't been offered it yet. When nobody is left, the service desk
 * is told to assign it by hand.
 *
 * At most one offer per incident is PENDING. Every move out of PENDING is
 * a conditional update (WHERE status = PENDING), so an accept racing the
 * expiry sweep has exactly one winner and only the winner moves on.
 */
@Injectable()
export class RoutingOffersService {
  private readonly logger = new Logger(RoutingOffersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly incidentsService: IncidentsService,
    private readonly routingService: RoutingService,
    private readonly inbox: InboxService,
    private readonly notifications: NotificationsPublisher,
  ) {}

  // --- Triggers ---------------------------------------------------------

  /** A new incident at a site with auto-routing on gets its first offer.
   *  Failures are logged and swallowed; the ticket just stays NEW. */
  @OnEvent(INCIDENT_CREATED_EVENT, { async: true })
  async onIncidentCreated(event: IncidentCreatedEvent, now: Date = new Date()): Promise<void> {
    try {
      const policy = await this.prisma.routingPolicy.findUnique({
        where: { siteId: event.siteId },
      });
      if (!policy?.autoAssignEnabled) {
        return;
      }
      await this.offerNext(event.incidentId, now, event.correlationId);
    } catch (err) {
      this.logger.error(
        `routing offer failed for new incident ${event.incidentId}: ${errorText(err)}`,
      );
    }
  }

  /** The ticket was assigned or moved on another way: close any open offer. */
  @OnEvent(INCIDENT_UPDATED_EVENT, { async: true })
  async onIncidentUpdated(event: IncidentUpdatedEvent): Promise<void> {
    if (event.status === IncidentStatus.NEW && !event.ownerUserId && !event.ownerGroupId) {
      return;
    }
    try {
      const open = await this.prisma.routingOffer.findMany({
        where: { incidentId: event.incidentId, status: RoutingOfferStatus.PENDING },
      });
      for (const offer of open) {
        await this.closeOffer(offer, RoutingOfferStatus.CANCELLED, {
          actorId: event.actorId,
          correlationId: event.correlationId,
        });
      }
    } catch (err) {
      this.logger.error(
        `cancelling routing offers for incident ${event.incidentId} failed: ${errorText(err)}`,
      );
    }
  }

  /** Every minute: expire overdue offers and move each ticket on. */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireOverdue(now: Date = new Date()): Promise<number> {
    let expired = 0;
    try {
      const due = (await this.prisma.routingOffer.findMany({
        where: { status: RoutingOfferStatus.PENDING, expiresAt: { lte: now } },
        include: { user: { select: { displayName: true, email: true } } },
        orderBy: { expiresAt: "asc" },
        take: EXPIRY_BATCH_SIZE,
      })) as OfferWithUser[];
      for (const offer of due) {
        try {
          const closed = await this.closeOffer(offer, RoutingOfferStatus.EXPIRED, {
            actorId: null,
          });
          if (!closed) {
            continue;
          }
          expired += 1;
          await this.incidentsService.recordRoutingEvent(offer.incidentId, null, {
            action: "EXPIRED",
            offerId: offer.id,
            userId: offer.userId,
            displayName: offer.user.displayName,
          });
          await this.offerNext(offer.incidentId, now);
        } catch (err) {
          this.logger.error(`expiring routing offer ${offer.id} failed: ${errorText(err)}`);
        }
      }
    } catch (err) {
      this.logger.error(`routing offer expiry sweep failed: ${errorText(err)}`);
    }
    return expired;
  }

  // --- Engineer responses -------------------------------------------------

  async accept(
    incidentId: string,
    user: AuthenticatedUser,
    actor: ActorContext,
    now: Date = new Date(),
  ): Promise<RoutingOfferView> {
    const offer = await this.openOfferFor(incidentId, user, now);
    const accepted = await this.closeOffer(offer, RoutingOfferStatus.ACCEPTED, actor, {
      respondedAt: now,
    });
    if (!accepted) {
      throw new ConflictException("This offer is no longer open");
    }

    let assigned: Incident | null;
    try {
      assigned = await this.incidentsService.autoAssign(
        incidentId,
        user.id,
        actor.correlationId,
        user.id,
      );
    } catch (err) {
      // Never leave an ACCEPTED offer on a ticket nobody owns.
      await this.transitionClosed(accepted, RoutingOfferStatus.CANCELLED, actor);
      throw err;
    }
    if (!assigned) {
      // Someone assigned the ticket between the offer and the accept.
      await this.transitionClosed(accepted, RoutingOfferStatus.CANCELLED, actor);
      throw new ConflictException("The ticket was already assigned to someone else");
    }
    return this.toView({ ...accepted, user: offer.user });
  }

  async decline(
    incidentId: string,
    user: AuthenticatedUser,
    reason: string | undefined,
    actor: ActorContext,
    now: Date = new Date(),
  ): Promise<RoutingOfferView> {
    const offer = await this.openOfferFor(incidentId, user, now);
    const declineReason = reason?.trim() || null;
    const declined = await this.closeOffer(offer, RoutingOfferStatus.DECLINED, actor, {
      respondedAt: now,
      declineReason,
    });
    if (!declined) {
      throw new ConflictException("This offer is no longer open");
    }
    await this.incidentsService.recordRoutingEvent(incidentId, user.id, {
      action: "DECLINED",
      offerId: offer.id,
      userId: user.id,
      displayName: offer.user.displayName,
      reason: declineReason,
    });
    try {
      await this.offerNext(incidentId, now, actor.correlationId);
    } catch (err) {
      // The decline itself succeeded; the expiry sweep can't recover this
      // (no pending offer is left), so leave a clear log line for the desk.
      this.logger.error(`next routing offer for incident ${incidentId} failed: ${errorText(err)}`);
    }
    return this.toView({ ...declined, user: offer.user });
  }

  async listForIncident(
    incidentId: string,
    user: AuthenticatedUser,
  ): Promise<IncidentRoutingOffers> {
    await this.incidentsService.findOneScoped(incidentId, user);
    const offers = (await this.prisma.routingOffer.findMany({
      where: { incidentId },
      include: { user: { select: { displayName: true, email: true } } },
      orderBy: { createdAt: "asc" },
    })) as OfferWithUser[];
    const history = offers.map((o) => this.toView(o));
    return {
      incidentId,
      pending: history.find((o) => o.status === RoutingOfferStatus.PENDING) ?? null,
      history,
    };
  }

  // --- Internals ----------------------------------------------------------

  /**
   * Offer the incident to the best-ranked engineer who hasn't had it yet.
   * Does nothing if the ticket is no longer NEW and unowned, or if an offer
   * is already open. With nobody left after at least one offer, the
   * service desk is told.
   */
  async offerNext(incidentId: string, now: Date, correlationId?: string): Promise<void> {
    const incident = await this.incidentsService.findOne(incidentId);
    if (!isUnowned(incident)) {
      return;
    }
    const previous = (await this.prisma.routingOffer.findMany({
      where: { incidentId },
      include: { user: { select: { displayName: true, email: true } } },
      orderBy: { createdAt: "asc" },
    })) as OfferWithUser[];
    if (previous.some((o) => o.status === RoutingOfferStatus.PENDING)) {
      return;
    }
    // Re-read every round: if the site turned auto-routing off after the
    // first offer, no further offers are made and the ticket stays NEW.
    const policy = await this.prisma.routingPolicy.findUnique({
      where: { siteId: incident.siteId },
    });
    if (!policy?.autoAssignEnabled) {
      return;
    }

    const suggestions = await this.routingService.rank(incident, now);
    const tried = new Set(previous.map((o) => o.userId));
    const untried = suggestions.candidates.filter((c) => !tried.has(c.userId));
    const next = await this.pickCandidate(incident, untried);
    if (!next) {
      if (previous.length > 0) {
        await this.onNobodyAccepted(incident, previous);
      } else {
        this.logger.log(
          `no routing offer for incident ${incident.id}: ${suggestions.reason ?? "no candidates"}`,
        );
      }
      return;
    }

    const timeoutMinutes = offerTimeoutFor(
      await this.routingService.getSettings(incident.siteId),
      incident.priority,
    );
    const expiresAt = new Date(now.getTime() + timeoutMinutes * 60_000);

    const offer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.routingOffer.create({
        data: { incidentId, userId: next.userId, expiresAt },
      });
      await this.auditService.record(
        {
          actorId: null,
          entityType: "RoutingOffer",
          entityId: created.id,
          action: "CREATE",
          after: created,
          correlationId,
        },
        tx,
      );
      return created;
    });

    await this.incidentsService.recordRoutingEvent(incidentId, null, {
      action: "OFFERED",
      offerId: offer.id,
      userId: next.userId,
      displayName: next.displayName,
      expiresAt: expiresAt.toISOString(),
      round: previous.length + 1,
    });
    await this.inbox.notifyUsers({
      userIds: [next.userId],
      kind: InAppNotificationKind.INCIDENT_OFFERED,
      title: `${incident.incidentNo} offered to you: accept within ${timeoutMinutes} min`,
      body: incident.shortDescription,
      entityType: "INCIDENT",
      entityId: incident.id,
      dedupeKey: `offer:${offer.id}`,
    });
    if (next.email) {
      await this.notifications.enqueue(
        {
          event: {
            kind: "INCIDENT_OFFERED",
            entity: {
              key: incident.incidentNo,
              title: incident.shortDescription,
              priority: incident.priority,
            },
            offeredTo: { name: next.displayName, email: next.email },
            expiresAt: expiresAt.toISOString(),
            timeoutMinutes,
          },
          recipients: { to: [{ name: next.displayName, email: next.email }] },
        },
        `INCIDENT_OFFERED:${offer.id}`,
      );
    }
  }

  /**
   * The best-ranked candidate to offer to next. Below P1, engineers already
   * holding an open offer on another ticket are passed over so offers spread
   * out; if every candidate has one, the best of them still gets it, so the
   * ticket never sits unoffered. A P1 goes to the best candidate regardless.
   */
  private async pickCandidate(
    incident: Incident,
    candidates: RoutingCandidate[],
  ): Promise<RoutingCandidate | undefined> {
    if (candidates.length === 0 || incident.priority === Priority.P1) {
      return candidates[0];
    }
    const busy = await this.prisma.routingOffer.findMany({
      where: {
        status: RoutingOfferStatus.PENDING,
        userId: { in: candidates.map((c) => c.userId) },
        incidentId: { not: incident.id },
      },
      select: { userId: true },
    });
    const busyIds = new Set(busy.map((o) => o.userId));
    return candidates.find((c) => !busyIds.has(c.userId)) ?? candidates[0];
  }

  private async onNobodyAccepted(incident: Incident, previous: OfferWithUser[]): Promise<void> {
    const names = previous.map((o) => o.user.displayName);
    // Keyed on the number of offers so a later round (after the desk
    // clears things up and new engineers come on shift) can alert again.
    const round = previous.length;
    await this.incidentsService.recordRoutingEvent(incident.id, null, {
      action: "UNACCEPTED",
      offeredTo: names,
    });
    const desk = await this.prisma.user.findMany({
      where: { isActive: true, role: UserRole.SERVICE_DESK_NOC },
      select: { id: true, email: true, displayName: true },
    });
    await this.inbox.notifyUsers({
      userIds: desk.map((u) => u.id),
      kind: InAppNotificationKind.INCIDENT_OFFER_UNACCEPTED,
      title: `No engineer accepted ${incident.incidentNo}: assign it manually`,
      body: `Offered to ${names.join(", ")}`,
      entityType: "INCIDENT",
      entityId: incident.id,
      dedupeKey: `unaccepted:${incident.id}:${round}`,
    });
    const to = desk.filter((u) => u.email).map((u) => ({ name: u.displayName, email: u.email }));
    if (to.length > 0) {
      await this.notifications.enqueue(
        {
          event: {
            kind: "INCIDENT_OFFER_UNACCEPTED",
            entity: {
              key: incident.incidentNo,
              title: incident.shortDescription,
              priority: incident.priority,
            },
            offeredTo: names,
          },
          recipients: { to },
        },
        `INCIDENT_OFFER_UNACCEPTED:${incident.id}:${round}`,
      );
    }
  }

  /** The caller's open offer on this incident, or the reason they can't act on it. */
  private async openOfferFor(
    incidentId: string,
    user: AuthenticatedUser,
    now: Date,
  ): Promise<OfferWithUser> {
    await this.incidentsService.findOneScoped(incidentId, user);
    const offer = (await this.prisma.routingOffer.findFirst({
      where: { incidentId, status: RoutingOfferStatus.PENDING },
      include: { user: { select: { displayName: true, email: true } } },
    })) as OfferWithUser | null;
    if (!offer) {
      throw new NotFoundException("There is no open offer on this incident");
    }
    if (offer.userId !== user.id) {
      throw new ForbiddenException("This offer was made to another engineer");
    }
    if (offer.expiresAt.getTime() <= now.getTime()) {
      throw new ConflictException("This offer has expired");
    }
    return offer;
  }

  /**
   * Moves a PENDING offer to `status` and audits it, only if it's still
   * PENDING. Returns the updated row, or null when someone else got there
   * first.
   */
  private async closeOffer(
    offer: RoutingOffer,
    status: RoutingOfferStatus,
    actor: { actorId: string | null; correlationId?: string },
    extra: { respondedAt?: Date; declineReason?: string | null } = {},
  ): Promise<RoutingOffer | null> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.routingOffer.updateMany({
        where: { id: offer.id, status: RoutingOfferStatus.PENDING },
        data: { status, ...extra },
      });
      if (count === 0) {
        return null;
      }
      const after = await tx.routingOffer.findUniqueOrThrow({ where: { id: offer.id } });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "RoutingOffer",
          entityId: offer.id,
          action: status,
          before: offerColumns(offer),
          after,
          correlationId: actor.correlationId,
        },
        tx,
      );
      return after;
    });
  }

  /** An accepted offer whose assign lost the race is marked CANCELLED. */
  private async transitionClosed(
    offer: RoutingOffer,
    status: RoutingOfferStatus,
    actor: ActorContext,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.routingOffer.update({ where: { id: offer.id }, data: { status } });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "RoutingOffer",
          entityId: offer.id,
          action: status,
          before: offerColumns(offer),
          after,
          correlationId: actor.correlationId,
        },
        tx,
      );
    });
  }

  private toView(offer: OfferWithUser): RoutingOfferView {
    return {
      id: offer.id,
      userId: offer.userId,
      displayName: offer.user.displayName,
      status: offer.status,
      expiresAt: offer.expiresAt.toISOString(),
      respondedAt: offer.respondedAt ? offer.respondedAt.toISOString() : null,
      declineReason: offer.declineReason,
      createdAt: offer.createdAt.toISOString(),
    };
  }
}

/** The offer row alone, without a joined user, for audit snapshots. */
function offerColumns(offer: RoutingOffer): RoutingOffer {
  const copy: Partial<OfferWithUser> = { ...offer };
  delete copy.user;
  return copy as RoutingOffer;
}

function isUnowned(incident: Incident): boolean {
  return incident.status === IncidentStatus.NEW && !incident.ownerUserId && !incident.ownerGroupId;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
