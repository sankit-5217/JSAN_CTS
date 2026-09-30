import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { PrismaService } from "../../common/prisma/prisma.service";
import {
  USER_DEACTIVATION_CHECK_EVENT,
  UserChangeBlocker,
  UserDeactivationCheck,
} from "../auth/user-change-checks";
import { OPEN_STATUSES } from "./incident-transitions";

const MAX_EXAMPLES = 5;

/**
 * Answers the auth module's "may this user be deactivated?" check: not
 * while they still own open incidents — those would sit with someone who
 * can't sign in. Reassign first.
 */
@Injectable()
export class IncidentUserChecksListener {
  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(USER_DEACTIVATION_CHECK_EVENT, { suppressErrors: false })
  async onDeactivationCheck(check: UserDeactivationCheck): Promise<UserChangeBlocker | null> {
    const where = { ownerUserId: check.userId, status: { in: OPEN_STATUSES } };
    const [count, examples] = await Promise.all([
      this.prisma.incident.count({ where }),
      this.prisma.incident.findMany({
        where,
        select: { incidentNo: true },
        orderBy: { createdAt: "asc" },
        take: MAX_EXAMPLES,
      }),
    ]);
    if (count === 0) return null;
    return {
      source: "incidents",
      message: `owns ${count} open incident${count === 1 ? "" : "s"} — reassign ${count === 1 ? "it" : "them"} first`,
      examples: examples.map((i) => i.incidentNo),
    };
  }
}
