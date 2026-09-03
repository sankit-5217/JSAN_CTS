import { normalizeHpeIloSystem } from "@cts-dc-opsdesk/hpe-ilo-adapter";
import { normalizeRedfishSystem } from "@cts-dc-opsdesk/redfish-adapter";
import type { HealthSnapshotPayload } from "@cts-dc-opsdesk/shared-types";
import type { EndpointTarget } from "../config";
import type { BufferedItem } from "../delivery-buffer";
import type { Credential, CredentialResolver } from "./credentials";
import type { MgmtHttp } from "./mgmt-http";
import { fetchRedfishBundle } from "./redfish-fetcher";

export interface HealthPollDeps {
  endpoints: EndpointTarget[];
  resolver: CredentialResolver;
  makeHttp: (baseUrl: string, credential: Credential) => MgmtHttp;
  enqueue: (item: Omit<BufferedItem, "queuedAt">) => void;
  now?: () => string;
  logger?: Pick<Console, "warn">;
}

export interface HealthPollResult {
  polled: number;
  enqueued: number;
  failed: Array<{ ciCode: string; reason: string }>;
}

/**
 * One pass over every configured endpoint: resolve its credential, fetch the
 * bundle, normalize via the matching adapter, enqueue a health snapshot.
 * Per-endpoint errors are isolated (collected in `failed`) — one unreachable
 * BMC never stops the poll.
 */
export async function runHealthPoll(deps: HealthPollDeps): Promise<HealthPollResult> {
  const { endpoints, resolver, makeHttp, enqueue } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const log = deps.logger ?? console;
  const failed: HealthPollResult["failed"] = [];
  let enqueued = 0;

  for (const ep of endpoints) {
    try {
      if (ep.kind === "DELL_OME") {
        // OME's REST shape (/api/DeviceService/Devices...) differs — its fetcher
        // lands with the dell-ome-adapter wiring.
        log.warn(`[collector] OME fetcher not implemented — skipping ${ep.ciCode}`);
        continue;
      }
      const credential = resolver.resolve(ep.credentialRef);
      if (!credential) {
        failed.push({ ciCode: ep.ciCode, reason: `no credential for "${ep.credentialRef}"` });
        continue;
      }
      const http = makeHttp(ep.address, credential);
      const bundle = await fetchRedfishBundle(http, ep.ciCode, now);
      const snapshot: HealthSnapshotPayload =
        ep.kind === "HPE_ILO" ? normalizeHpeIloSystem(bundle) : normalizeRedfishSystem(bundle);

      enqueue({
        key: `health:${ep.ciCode}:${snapshot.observedAt}`,
        channel: "health",
        payload: snapshot,
      });
      enqueued += 1;
    } catch (err) {
      failed.push({ ciCode: ep.ciCode, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { polled: endpoints.length, enqueued, failed };
}
