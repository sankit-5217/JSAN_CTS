import { createHash } from "crypto";

/** SHA-256 hex of a secret token: only this is stored for invite/reset links and API tokens. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
