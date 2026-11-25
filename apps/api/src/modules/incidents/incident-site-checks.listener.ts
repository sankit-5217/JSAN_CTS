import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { PrismaService } from "../../common/prisma/prisma.service";
import {
  SITE_ARCHIVE_CHECK_EVENT,
  SiteArchiveBlocker,
  SiteArchiveCheck,
} from "../sites/site-status";
import { OPEN_STATUSES } from "./incident-transitions";

const MAX_EXAMPLES = 5;

/**
 * Answers the sites module's "may this site be deleted (archived)?" check:
 * not while it still has open tickets — they'd vanish from every list.
 * Resolve, close or cancel them first.
 */
@Injectable()
export class IncidentSiteChecksListener {
  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(SITE_ARCHIVE_CHECK_EVENT, { suppressErrors: false })
  async onArchiveCheck(check: SiteArchiveCheck): Promise<SiteArchiveBlocker | null> {
    const where = { siteId: check.siteId, status: { in: OPEN_STATUSES } };
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
      message: `it has ${count} open ticket${count === 1 ? "" : "s"} — resolve, close or cancel ${count === 1 ? "it" : "them"} first`,
      examples: examples.map((i) => i.incidentNo),
    };
  }
}
