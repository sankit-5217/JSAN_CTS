import { readFileSync } from "node:fs";
import { Agent } from "undici";

/**
 * mTLS material for the outbound connection to the OpsDesk API (ADR-004:
 * "outbound over HTTPS/mTLS only"). Files are read from the local host — the
 * collector never carries central user credentials, only its own client cert.
 */
export interface TlsMaterial {
  certFile: string;
  keyFile: string;
  /** Optional CA bundle to verify the API's server cert against. */
  caFile?: string;
}

/**
 * Build an undici dispatcher that presents the client certificate on every
 * request. Returns `undefined` when `tls` is absent, so the caller falls back to
 * the default global dispatcher (plain TLS). Throws if a configured file is
 * unreadable — a misconfigured cert should fail loud at startup.
 */
export function buildApiDispatcher(tls: TlsMaterial | undefined): Agent | undefined {
  if (!tls) {
    return undefined;
  }
  return new Agent({
    connect: {
      cert: readFileSync(tls.certFile, "utf8"),
      key: readFileSync(tls.keyFile, "utf8"),
      ...(tls.caFile ? { ca: readFileSync(tls.caFile, "utf8") } : {}),
    },
  });
}

/**
 * Dispatcher for the LAN management endpoints (Redfish / OME / iLO). These
 * routinely present self-signed certs, so `insecure` disables verification for
 * those connections only — never for the outbound API connection.
 */
export function buildEndpointDispatcher(insecure: boolean): Agent | undefined {
  if (!insecure) {
    return undefined;
  }
  return new Agent({ connect: { rejectUnauthorized: false } });
}
