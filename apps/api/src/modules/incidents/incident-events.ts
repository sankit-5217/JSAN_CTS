/**
 * Domain events the incidents module publishes (in-process, via
 * @nestjs/event-emitter). Other modules subscribe instead of being called
 * directly — e.g. the routing module auto-assigns on INCIDENT_CREATED
 * without IncidentsModule ever importing RoutingModule (which already
 * depends on this module; a direct call would be circular).
 *
 * Emitted only after the creating transaction commits, so a listener
 * always sees the committed row.
 */
export const INCIDENT_CREATED_EVENT = "incident.created";

export interface IncidentCreatedEvent {
  incidentId: string;
  siteId: string;
  /** The incident's CI, if any. The alerts module back-links that CI's
   *  still-open, uncorrelated alerts to the new incident. */
  ciId: string | null;
  /** Who created it (a monitoring service account for an alert-opened one). */
  actorId: string;
  correlationId?: string;
}

/**
 * Emitted after a PATCH or a status transition commits, with the incident's
 * new status and ownership. The routing module uses it to cancel an open
 * offer once the ticket has been assigned or moved on some other way.
 */
export const INCIDENT_UPDATED_EVENT = "incident.updated";

export interface IncidentUpdatedEvent {
  incidentId: string;
  status: string;
  ownerUserId: string | null;
  ownerGroupId: string | null;
  /** Current CI — set on a client-reported ticket once Service Desk triages
   *  it, which is when the CI's open alerts get back-linked. */
  ciId: string | null;
  actorId: string | null;
  correlationId?: string;
}
