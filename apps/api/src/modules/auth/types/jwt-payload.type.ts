import { UserRole } from "@prisma/client";

/** Shape signed into the JWT (`sub` is the standard "subject" claim = user id). */
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  /** The user's sessionVersion when issued; a mismatch means "signed out". */
  sv: number;
  /** Present (true) while an admin-set password must be changed — for the web app's redirect. */
  pwc?: true;
}

/** Shape attached to `req.user` after JwtStrategy.validate() re-loads the user. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  /**
   * True while the user must replace an admin-set password: JwtAuthGuard then
   * refuses every route not marked @AllowWhilePasswordChangeRequired().
   * Never set for machine API tokens.
   */
  mustChangePassword?: boolean;
}
