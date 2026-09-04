import { getStoredToken } from "./client";

/** Payload shape the API's JWTs carry (apps/api's AuthenticatedUser). */
export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

/**
 * Decodes a JWT's payload **without verifying its signature** — display
 * only (current user's email/role in the nav bar). The backend re-verifies
 * every token server-side on every request; nothing here is ever trusted
 * for authorization.
 */
export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split(".");
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Current user's role, for UI-only show/hide of write controls (e.g. "Create
 * site" buttons) against a flat, static write-role list mirroring a
 * controller's `@Roles(...)` decorator. This is UX, never the security
 * boundary — the backend re-checks the same role server-side on every
 * request regardless of what this returns.
 */
export function getCurrentUserRole(): string | null {
  const token = getStoredToken();
  return token ? (decodeJwtPayload(token)?.role ?? null) : null;
}
