/** Who's making a mutation and how to trace it — passed into every service write. */
export interface ActorContext {
  actorId: string;
  correlationId?: string;
}
