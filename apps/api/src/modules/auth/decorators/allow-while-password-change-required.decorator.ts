import { SetMetadata } from "@nestjs/common";

export const ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED = "allowWhilePasswordChangeRequired";

/**
 * Marks a route a user may call while they still have to replace an
 * admin-set password (changing it, reading who they are). Every other
 * route answers 403 PASSWORD_CHANGE_REQUIRED for them (JwtAuthGuard).
 */
export const AllowWhilePasswordChangeRequired = () =>
  SetMetadata(ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED, true);
