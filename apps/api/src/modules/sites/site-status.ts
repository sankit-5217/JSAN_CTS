import { BadRequestException } from "@nestjs/common";

/**
 * Site lifecycle (owner: sites module). Sites are never hard-deleted —
 * tickets, CIs, alerts and the audit trail point at them — so "Delete site"
 * archives: the site disappears from lists, pickers and the client portal
 * and takes no new work, its history stays, and a Super Admin can restore it.
 */
export const SITE_ACTIVE = "ACTIVE";
export const SITE_ARCHIVED = "ARCHIVED";

/**
 * Asked of other modules before a site is archived, via
 * `eventEmitter.emitAsync(...)` (same pattern as auth's user-change-checks):
 * each answers from its own data, so sites never reads their tables.
 * Listeners return a blocker to veto, or null; register with
 * `suppressErrors: false` so a failing check fails the request.
 */
export const SITE_ARCHIVE_CHECK_EVENT = "site.archive.check";

export interface SiteArchiveCheck {
  siteId: string;
}

export interface SiteArchiveBlocker {
  /** Owning module, e.g. "incidents". */
  source: string;
  /** Shown as-is in the admin UI. */
  message: string;
  examples?: string[];
}

/** Anything with Prisma's `site.findUnique` (the client or a transaction). */
interface SiteReader {
  site: {
    findUnique(args: {
      where: { id: string };
      select: { code: true; status: true };
    }): Promise<{ code: string; status: string } | null>;
  };
}

/**
 * Refuses new work (tickets, agent enrollments) on an archived site. A
 * missing site is left to the caller's own not-found / foreign-key handling.
 */
export async function assertSiteAcceptsNewWork(db: SiteReader, siteId: string): Promise<void> {
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { code: true, status: true },
  });
  if (site?.status === SITE_ARCHIVED) {
    throw new BadRequestException(
      `Site ${site.code} is archived and takes no new work. Restore it first (Sites page).`,
    );
  }
}
