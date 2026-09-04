import { WarrantyProviderError } from "./errors";
import type {
  WarrantyFetch,
  WarrantyLookupQuery,
  WarrantyLookupResult,
  WarrantyProvider,
} from "./types";

const PROVIDER_NAME = "hpe-warranty";
const DEFAULT_BASE_URL = "https://warranty.api.hpe.com/productWarranty/v2";

/** One offer/entitlement in the HPE warranty response. */
export interface HpeOfferEntitlement {
  offerName?: string;
  serviceLevel?: string;
  startDate?: string;
  endDate?: string;
}

/** The per-product node HPE returns for a serial lookup. */
export interface HpeWarrantyProduct {
  serialNumber?: string;
  productNumber?: string;
  offers?: HpeOfferEntitlement[];
  warrantyEndDate?: string;
}

/**
 * Reduce an HPE product node to one normalized result. Prefers the latest
 * `offers[].endDate`; falls back to the product-level `warrantyEndDate`.
 * Pure — no I/O.
 */
export function normalizeHpeWarranty(
  product: HpeWarrantyProduct | undefined,
  now: Date = new Date(),
): WarrantyLookupResult {
  const offers = product?.offers ?? [];
  let latest: HpeOfferEntitlement | undefined;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const offer of offers) {
    const ms = offer.endDate ? Date.parse(offer.endDate) : NaN;
    if (!Number.isNaN(ms) && ms > latestMs) {
      latestMs = ms;
      latest = offer;
    }
  }

  if (latestMs === Number.NEGATIVE_INFINITY && product?.warrantyEndDate) {
    const ms = Date.parse(product.warrantyEndDate);
    if (!Number.isNaN(ms)) {
      latestMs = ms;
    }
  }

  if (latestMs === Number.NEGATIVE_INFINITY) {
    return { status: "UNKNOWN", provider: PROVIDER_NAME };
  }

  return {
    status: latestMs >= now.getTime() ? "ACTIVE" : "EXPIRED",
    provider: PROVIDER_NAME,
    expiresAt: new Date(latestMs).toISOString(),
    ...(latest?.offerName ? { coverageLevel: latest.offerName } : {}),
  };
}

export interface HpeWarrantyProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: WarrantyFetch;
  now?: () => Date;
}

/**
 * HPE product-warranty API client (read-only). Same shape as the Dell provider:
 * a single keyed request plus a pure normalization step.
 */
export class HpeWarrantyProvider implements WarrantyProvider {
  readonly name = PROVIDER_NAME;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: WarrantyFetch;
  private readonly now: () => Date;

  constructor(opts: HpeWarrantyProviderOptions) {
    if (!opts.apiKey) {
      throw new WarrantyProviderError("HPE warranty provider requires an apiKey", PROVIDER_NAME);
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
    const v = vendor.trim().toUpperCase();
    return v === "HPE" || v === "HP" || v === "HEWLETT PACKARD ENTERPRISE";
  }

  async lookup(query: WarrantyLookupQuery): Promise<WarrantyLookupResult> {
    const serial = query.serialOrServiceTag.trim();
    if (!serial) {
      throw new WarrantyProviderError("empty serial number", PROVIDER_NAME);
    }
    let res: Awaited<ReturnType<WarrantyFetch>>;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/lookup`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ serialNumber: serial }),
      });
    } catch (err) {
      throw new WarrantyProviderError(
        `HPE warranty request failed: ${err instanceof Error ? err.message : String(err)}`,
        PROVIDER_NAME,
      );
    }
    const body = await res.text();
    if (!res.ok) {
      throw new WarrantyProviderError(
        `HPE warranty API responded ${res.status}`,
        PROVIDER_NAME,
        res.status,
      );
    }

    let parsed: unknown;
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      throw new WarrantyProviderError("HPE warranty API returned non-JSON", PROVIDER_NAME);
    }
    const products = extractProducts(parsed);
    const product =
      products.find((p) => (p.serialNumber ?? "").trim().toUpperCase() === serial.toUpperCase()) ??
      products[0];
    return normalizeHpeWarranty(product, this.now());
  }
}

function extractProducts(parsed: unknown): HpeWarrantyProduct[] {
  if (Array.isArray(parsed)) {
    return parsed as HpeWarrantyProduct[];
  }
  if (parsed && typeof parsed === "object") {
    const node = parsed as { products?: unknown };
    if (Array.isArray(node.products)) {
      return node.products as HpeWarrantyProduct[];
    }
    return [parsed as HpeWarrantyProduct];
  }
  return [];
}
