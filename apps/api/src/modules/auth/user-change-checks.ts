import { UserRole } from "@prisma/client";

/**
 * Pre-change checks the auth module asks other modules before a user admin
 * change, via `eventEmitter.emitAsync(...)`. Each owning module answers
 * from its own data (incidents: open tickets; skills/shifts: engineer-only
 * holdings), so auth never reads another module's tables — and never
 * imports those modules, which already depend on auth (a direct call would
 * be circular). Same pattern as incident-events.ts.
 *
 * Listeners return a `UserChangeBlocker` to veto the change, or null.
 * Register them with `suppressErrors: false` so a failing check fails the
 * request instead of silently passing.
 */
export const USER_DEACTIVATION_CHECK_EVENT = "user.deactivation.check";
export const USER_ROLE_CHANGE_CHECK_EVENT = "user.role_change.check";

export interface UserDeactivationCheck {
  userId: string;
}

export interface UserRoleChangeCheck {
  userId: string;
  fromRole: UserRole;
  toRole: UserRole;
}

export interface UserChangeBlocker {
  /** Owning module, e.g. "incidents". */
  source: string;
  /** Human-readable reason, shown as-is in the admin UI. */
  message: string;
  /** A few identifiers to act on (e.g. incident numbers), capped by the listener. */
  examples?: string[];
}
