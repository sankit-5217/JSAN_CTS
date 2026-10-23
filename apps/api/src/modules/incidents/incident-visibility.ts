import { Prisma, RoutingOfferStatus, UserRole } from "@prisma/client";
import { AuthenticatedUser } from "../auth/types/jwt-payload.type";

/**
 * Roles that only ever see their own incidents, on top of site scope: a
 * Site Engineer works the tickets assigned to them, not the whole site
 * queue. Admin, Service Desk and the other staff roles keep the site-wide
 * view.
 */
const OWN_INCIDENTS_ONLY_ROLES: readonly UserRole[] = [UserRole.SITE_ENGINEER];

export function seesOwnIncidentsOnly(user: AuthenticatedUser): boolean {
  return OWN_INCIDENTS_ONLY_ROLES.includes(user.role);
}

/**
 * The extra incident filter for a caller who only sees their own work:
 * incidents they own, plus ones currently offered to them by routing (so
 * they can open the ticket and accept or decline). Null for every caller
 * with the site-wide view. Forced from the caller's role — never
 * client-settable. Shared with the reports read models so dashboard counts
 * match the list.
 */
export function ownIncidentsFilter(user: AuthenticatedUser): Prisma.IncidentWhereInput | null {
  if (!seesOwnIncidentsOnly(user)) {
    return null;
  }
  return {
    OR: [
      { ownerUserId: user.id },
      { routingOffers: { some: { userId: user.id, status: RoutingOfferStatus.PENDING } } },
    ],
  };
}

/** Tickets assigned to the caller or currently being offered to them. */
function assignedOrOffered(user: AuthenticatedUser): Prisma.IncidentWhereInput[] {
  return [
    { ownerUserId: user.id },
    { routingOffers: { some: { userId: user.id, status: RoutingOfferStatus.PENDING } } },
  ];
}

/**
 * Which incidents a staff caller may see: those at sites they have access
 * to, **plus** — whatever their site grants — the tickets assigned to them
 * or being offered to them. Whoever a ticket is assigned to can always see
 * and work it (only that ticket; the rest of its site stays hidden).
 *
 * A Site Engineer sees their own work only, so for them site grants don't
 * widen anything. `undefined` = every incident (all-sites roles).
 * Client viewers are scoped by reporter separately and never come here.
 */
export function incidentAccessWhere(
  user: AuthenticatedUser,
  accessibleSiteIds: string[] | null | undefined,
): Prisma.IncidentWhereInput | undefined {
  if (seesOwnIncidentsOnly(user)) {
    return { OR: assignedOrOffered(user) };
  }
  if (!accessibleSiteIds) {
    return undefined;
  }
  return { OR: [{ siteId: { in: accessibleSiteIds } }, ...assignedOrOffered(user)] };
}
