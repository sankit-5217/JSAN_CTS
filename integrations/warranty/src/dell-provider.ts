import { WarrantyProviderError } from "./errors";
import type {
  WarrantyFetch,
  WarrantyLookupQuery,
  WarrantyLookupResult,
  WarrantyProvider,
} from "./types";

const PROVIDER_NAME = "dell-techdirect";
const DEFAULT_BASE_URL = "https://apigtwb2c.us.dell.com/PROD/sbil/v5";

/** One entitlement line as returned by the Dell asset-entitlements endpoint. */
export interface DellEntitlement {
  serviceLevelDescription?: string;
  startDate?: string;
  endDate?: string;
  entitlementType?: string;
}

/** One asset object in the Dell response array. */
export interface DellAssetEntitlement {
  serviceTag?: string;
  entitlements?: DellEntitlement[];
}

/**
 * Reduce a Dell asset's entitlement lines to one normalized result: the line
 * with the latest `endDate` wins, and status is ACTIVE while that date is in
 * the future. Pure — no I/O, safe to unit-test against fixtures.
 */
export function normalizeDellWarranty(
  asset: DellAssetEntitlement | undefined,
  serviceTag: string,
  now: Date = new Date(),
): WarrantyLookupResult {
  const lines = asset?.entitlements ?? [];
  let latest: DellEntitlement | undefined;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    const ms = line.endDate ? Date.parse(line.endDate) : NaN;
    if (!Number.isNaN(ms) && ms > latestMs) {
      latestMs = ms;
      latest = line;
    }
  }

  if (!latest || latestMs === Number.NEGATIVE_INFINITY) {
    return { status: "UNKNOWN", provider: PROVIDER_NAME };
  }

  return {
    status: latestMs >= now.getTime() ? "ACTIVE" : "EXPIRED",
    provider: PROVIDER_NAME,
    expiresAt: new Date(latestMs).toISOString(),
    ...(latest.serviceLevelDescription
      ? { coverageLevel: latest.serviceLevelDescription }
      : {}),
  };
}

export interface DellWarrantyProviderOptions {
  /** OAuth2 access token / API key for the Dell Warranty API. Required. */
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: WarrantyFetch;
  now?: () => Date;
}

/**
 * Dell Warranty API client (read-only). NOTE: production use also needs the
 * OAuth2 client-credentials exchange to mint `apiKey` — that token refresh is
 * expected to be handled by the caller/secret store and injected here, keeping
 * this class a thin, testable request+normalize unit.
 */
export class DellWarrantyProvider implements WarrantyProvider {
  readonly name = PROVIDER_NAME;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: WarrantyFetch;
  private readonly now: () => Date;

  constructor(opts: DellWarrantyProviderOptions) {
    if (!opts.apiKey) {
      throw new WarrantyProviderError("Dell warranty provider requires an apiKey", PROVIDER_NAME);
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as WarrantyFetch);
    this.now = opts.now ?? (() => new Date());
    if (!this.fetchImpl) {
      throw new WarrantyProviderError(
        "no fetch implementation available (Node >= 18 or pass fetchImpl)",
        PROVIDER_NAME,
      );
    }
  }

  supports(vendor: string): boolean {
    return vendor.trim().toUpperCase() === "DELL";
  }

  async lookup(query: WarrantyLookupQuery): Promise<WarrantyLookupResult> {
    const tag = query.serialOrServiceTag.trim();
    if (!tag) {
      throw new WarrantyProviderError("empty service tag", PROVIDER_NAME);
    }
    const url = `${this.baseUrl}/asset-entitlements?servicetags=${encodeURIComponent(tag)}`;
    let res: Awaited<ReturnType<WarrantyFetch>>;
    try {
      res = await this.fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${this.apiKey}` },
      });
    } catch (err) {
      throw new WarrantyProviderError(
        `Dell warranty request failed: ${err instanceof Error ? err.message : String(err)}`,
        PROVIDER_NAME,
      );
    }
    const body = await res.text();
    if (!res.ok) {
      throw new WarrantyProviderError(
        `Dell warranty API responded ${res.status}`,
        PROVIDER_NAME,
        res.status,
      );
    }

    let parsed: unknown;
    try {
      parsed = body ? JSON.parse(body) : [];
    } catch {
      throw new WarrantyProviderError("Dell warranty API returned non-JSON", PROVIDER_NAME);
    }
    const assets = Array.isArray(parsed) ? (parsed as DellAssetEntitlement[]) : [];
    const asset =
      assets.find((a) => (a.serviceTag ?? "").trim().toUpperCase() === tag.toUpperCase()) ??
      assets[0];
    return normalizeDellWarranty(asset, tag, this.now());
  }
}
