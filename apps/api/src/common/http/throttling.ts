import { createHash } from "crypto";
import { ConfigService } from "@nestjs/config";
import type { ThrottlerModuleOptions } from "@nestjs/throttler";

/**
 * Two rate limits, both per minute (spec §18: protect login, search,
 * ingestion and webhooks):
 *
 * - `default`, keyed by client IP: a ceiling on how much one address can
 *   send. Generous, because a whole office can sit behind one NAT address.
 *   The strict login/password limits (@Throttle({ default: ... }) on the
 *   auth routes) override this one, so they stay per IP and can't be
 *   dodged by inventing a bearer token.
 * - `perCaller`, keyed by the caller's bearer token (IP when there is
 *   none): one person's browser — the incident page alone polls ~150
 *   requests a minute — can't starve everyone else on the same address.
 *
 * Token-authenticated machine intake (alert webhooks, collector) is
 * exempt with @SkipThrottle(): an alert storm must never be answered with
 * 429, because a monitoring source that gives up loses the alert.
 *
 * Client IPs are real only because main.ts sets "trust proxy" (Railway and
 * any load balancer put the browser's address in X-Forwarded-For).
 */
export function throttlerOptions(config: ConfigService): ThrottlerModuleOptions {
  return [
    {
      name: "default",
      ttl: 60_000,
      limit: Number(config.get("RATE_LIMIT_PER_IP_PER_MINUTE") ?? 3000),
    },
    {
      name: "perCaller",
      ttl: 60_000,
      limit: Number(config.get("RATE_LIMIT_PER_CALLER_PER_MINUTE") ?? 600),
      getTracker: (req: Record<string, unknown>) => callerKey(req),
    },
  ];
}

/** The bearer token's hash (never the token itself), else the client IP. */
export function callerKey(req: Record<string, unknown>): string {
  const headers = (req.headers ?? {}) as Record<string, string | undefined>;
  const auth = headers.authorization ?? "";
  if (auth.toLowerCase().startsWith("bearer ") && auth.length > 7) {
    return `tok:${createHash("sha256").update(auth.slice(7)).digest("hex").slice(0, 32)}`;
  }
  return `ip:${String(req.ip ?? "unknown")}`;
}
