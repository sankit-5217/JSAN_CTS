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
