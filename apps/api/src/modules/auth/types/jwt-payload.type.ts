import { UserRole } from "@prisma/client";

/** Shape signed into the JWT (`sub` is the standard "subject" claim = user id). */
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

/** Shape attached to `req.user` after JwtStrategy.validate() re-loads the user. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
}
