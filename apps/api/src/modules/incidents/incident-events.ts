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
  correlationId?: string;
}
