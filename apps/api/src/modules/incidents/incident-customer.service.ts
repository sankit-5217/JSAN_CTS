import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InAppNotificationKind, IncidentStatus, Prisma, UserRole } from "@prisma/client";
import { ActorContext } from "../../common/types/actor-context.type";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";
import { InboxService } from "../inbox/inbox.service";
import { levelForPriority } from "../inbox/notification-sound-rules.service";
import { CustomerFeedbackDto, CustomerFeedbackOutcome } from "./dto/customer-feedback.dto";
import { IncidentsService } from "./incidents.service";

export interface IncidentProgress {
  status: IncidentStatus;
  /** Names only, for "who's handling this". Null until assigned. */
  handledBy: { engineer: string | null; team: string | null };
  /** Every status the ticket has been in, oldest first, starting at NEW. */
  milestones: { status: IncidentStatus; at: Date }[];
  /** When the ticket last went to PENDING_CUSTOMER, while it's still there. */
  waitingOnCustomerSince: Date | null;
  /** The reporter has replied since the ticket started waiting on them. */
  customerRepliedWhileWaiting: boolean;
  /** The reporter's answer to "is this fixed?" for the latest resolution. */
  feedback: { outcome: CustomerFeedbackOutcome; at: Date } | null;
}

/**
 * The customer side of a ticket's conversation: a plain progress summary
 * both the client portal and the staff incident page read, and the
 * customer's "is this fixed?" answer on a resolved ticket.
 *
 * Feedback is a signal, not a status change. The transition table (spec
 * §15) doesn't give CLIENT_MANAGER_VIEWER any transition, so a confirmed
 * fix still needs Service Desk to close it, and "not fixed" needs someone
 * to reopen it. What this adds is that they're told, loudly, and the
 * incident page shows it.
 */
@Injectable()
export class IncidentCustomerService {
  private readonly logger = new Logger(IncidentCustomerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly inbox: InboxService,
    private readonly incidents: IncidentsService,
  ) {}

  async getProgress(incidentId: string, user: AuthenticatedUser): Promise<IncidentProgress> {
    const incident = await this.incidents.findOneScoped(incidentId, user);
    const [events, owner, group] = await Promise.all([
      this.prisma.incidentEvent.findMany({
        where: { incidentId, eventType: { in: ["STATUS_CHANGE", "CUSTOMER_FEEDBACK"] } },
        orderBy: { createdAt: "asc" },
      }),
      incident.ownerUserId
        ? this.prisma.user.findUnique({
            where: { id: incident.ownerUserId },
            select: { displayName: true },
          })
        : null,
      incident.ownerGroupId
        ? this.prisma.supportGroup.findUnique({
            where: { id: incident.ownerGroupId },
            select: { name: true },
          })
        : null,
    ]);

    const milestones: IncidentProgress["milestones"] = [
      { status: IncidentStatus.NEW, at: incident.createdAt },
    ];
    let feedback: IncidentProgress["feedback"] = null;
    for (const e of events) {
      const payload = (e.payload ?? {}) as Record<string, unknown>;
      if (e.eventType === "STATUS_CHANGE" && typeof payload.to === "string") {
        milestones.push({ status: payload.to as IncidentStatus, at: e.createdAt });
        if (payload.to === IncidentStatus.RESOLVED) {
          feedback = null; // a new resolution needs a new answer
        }
      } else if (e.eventType === "CUSTOMER_FEEDBACK") {
        feedback = { outcome: payload.outcome as CustomerFeedbackOutcome, at: e.createdAt };
      }
    }

    const last = milestones[milestones.length - 1];
    const waitingOnCustomerSince =
      incident.status === IncidentStatus.PENDING_CUSTOMER && last.status === incident.status
        ? last.at
        : null;
    let customerRepliedWhileWaiting = false;
    if (waitingOnCustomerSince && incident.reportedByUserId) {
      const replies = await this.prisma.incidentComment.count({
        where: {
          incidentId,
          authorId: incident.reportedByUserId,
          isInternal: false,
          createdAt: { gt: waitingOnCustomerSince },
        },
      });
      customerRepliedWhileWaiting = replies > 0;
    }

    return {
      status: incident.status,
      handledBy: { engineer: owner?.displayName ?? null, team: group?.name ?? null },
      milestones,
      waitingOnCustomerSince,
      customerRepliedWhileWaiting,
      feedback,
    };
  }

  /**
   * The reporter tells us whether a RESOLVED ticket is really fixed. Posts
   * a customer-visible comment with their words, records a CUSTOMER_FEEDBACK
   * timeline event and an audit record in one transaction, then tells the
   * people who can act on it: whoever handles the ticket plus the service
   * desk.
   */
  async submitFeedback(
    incidentId: string,
    dto: CustomerFeedbackDto,
    actor: ActorContext,
    user: AuthenticatedUser,
  ) {
    const incident = await this.incidents.findOneScoped(incidentId, user);
    if (incident.status !== IncidentStatus.RESOLVED) {
      throw new BadRequestException(
        "You can confirm a fix only while the ticket is marked resolved",
      );
    }
    const note = dto.comment?.trim();
    if (dto.outcome === "NOT_FIXED" && !note) {
      throw new BadRequestException("Tell us what's still wrong so we can pick it back up");
    }
    const body =
      dto.outcome === "FIXED"
        ? `Confirmed: the issue is fixed.${note ? `\n\n${note}` : ""}`
        : `Not fixed yet: ${note}`;

    const { comment, event } = await this.prisma.$transaction(async (tx) => {
      const comment = await tx.incidentComment.create({
        data: { incidentId, authorId: actor.actorId, body, isInternal: false },
      });
      await tx.incidentEvent.create({
        data: {
          incidentId,
          eventType: "COMMENT",
          actorId: actor.actorId,
          payload: { commentId: comment.id, isInternal: false } as Prisma.InputJsonValue,
        },
      });
      const event = await tx.incidentEvent.create({
        data: {
          incidentId,
          eventType: "CUSTOMER_FEEDBACK",
          actorId: actor.actorId,
          payload: { outcome: dto.outcome, commentId: comment.id } as Prisma.InputJsonValue,
        },
      });
      await this.auditService.record(
        {
          actorId: actor.actorId,
          entityType: "Incident",
          entityId: incidentId,
          action: "CUSTOMER_FEEDBACK",
          after: { outcome: dto.outcome, commentId: comment.id },
          correlationId: actor.correlationId,
        },
        tx,
      );
      return { comment, event };
    });

    try {
      await this.inbox.notifyUsers({
        userIds: await this.incidents.supportRecipientIds(incident, true),
        actorUserId: user.id,
        kind: InAppNotificationKind.CUSTOMER_RESPONDED,
        title:
          dto.outcome === "FIXED"
            ? `${incident.incidentNo}: customer confirmed the fix, ready to close`
            : `${incident.incidentNo}: customer says it's not fixed`,
        body: note ?? incident.shortDescription,
        entityType: "INCIDENT",
        entityId: incident.id,
        level: levelForPriority(incident.priority),
        dedupeKey: `feedback:${event.id}`,
      });
    } catch (err) {
      this.logger.warn(
        `customer-feedback notification skipped for incident ${incident.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return { outcome: dto.outcome, at: event.createdAt, comment };
  }
}

/** Only the reporter answers "is this fixed?" (the service enforces the
 *  ownership through findOneScoped). */
export const CUSTOMER_FEEDBACK_ROLES = [UserRole.CLIENT_MANAGER_VIEWER] as const;
