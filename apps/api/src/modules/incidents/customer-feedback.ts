import { IncidentStatus } from "@prisma/client";
import { CustomerFeedbackOutcome } from "./dto/customer-feedback.dto";

/**
 * The customer's own answer to "is it fixed?", as recorded on the ticket's
 * timeline. `at` is when they gave it.
 */
export interface CustomerFeedback {
  outcome: CustomerFeedbackOutcome;
  at: Date;
}

/** The timeline rows the feedback rule needs, oldest first. */
export interface FeedbackTimelineEvent {
  eventType: string;
  payload: unknown;
  createdAt: Date;
}

/**
 * The customer's current answer to "is it fixed?" for one ticket, from
 * its timeline — or null if they haven't answered (or the answer was for
 * an earlier fix).
 *
 * A new resolution invalidates the old answer: when the desk re-resolves
 * a ticket, the customer has to confirm the *new* fix, so the previous
 * "it's fixed" no longer counts. The same rule the ticket page shows, in
 * one place so the progress view and the client's reports never disagree.
 *
 * Events must be oldest first.
 */
export function currentCustomerFeedback(
  events: readonly FeedbackTimelineEvent[],
): CustomerFeedback | null {
  let feedback: CustomerFeedback | null = null;
  for (const event of events) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.eventType === "STATUS_CHANGE" && payload.to === IncidentStatus.RESOLVED) {
      feedback = null; // a new resolution needs a new answer
    } else if (event.eventType === "CUSTOMER_FEEDBACK") {
      const outcome = payload.outcome;
      if (outcome === "FIXED" || outcome === "NOT_FIXED") {
        feedback = { outcome, at: event.createdAt };
      }
    }
  }
  return feedback;
}
