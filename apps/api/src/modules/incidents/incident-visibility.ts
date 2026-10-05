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
