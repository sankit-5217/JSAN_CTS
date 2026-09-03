/**
 * Vendor warranty lookup contract. Deliberately narrow: the OpsDesk platform
 * only records *current* coverage state and an expiry date against a CI — never
 * raw entitlement documents or per-line service SKUs (spec §10.13, "keep
 * telemetry/large payloads out of Postgres" applies to vendor data too).
 */

/** Normalized coverage state — matches the Prisma `WarrantyStatus` enum. */
export type WarrantyState = "ACTIVE" | "EXPIRED" | "UNKNOWN";

export const WARRANTY_STATES: readonly WarrantyState[] = ["ACTIVE", "EXPIRED", "UNKNOWN"];

/** What we hand a provider to identify one asset. */
export interface WarrantyLookupQuery {
  /** Free-form manufacturer string off the CI (`ConfigurationItem.manufacturer`), e.g. "DELL", "HPE". */
  vendor: string;
  /** Service tag / serial (`ConfigurationItem.serialOrServiceTag`). */
  serialOrServiceTag: string;
}

/** Normalized result — the only shape the sync service persists. */
export interface WarrantyLookupResult {
  status: WarrantyState;
  /** Which provider answered, recorded on the `Warranty` row for traceability. */
  provider: string;
  /** ISO-8601 date; omitted when the provider has no end date (e.g. UNKNOWN). */
  expiresAt?: string;
  /** Optional human label ("ProSupport Plus", "Foundation Care") — informational only. */
  coverageLevel?: string;
}

/**
 * One warranty source. Implementations MUST be read-only and side-effect free
 * beyond the outbound lookup call. A provider that cannot answer for a vendor
 * returns `supports() === false` rather than throwing.
 */
export interface WarrantyProvider {
  /** Stable id, e.g. "dell-techdirect", "stub". */
  readonly name: string;
  /** True if this provider can look the given manufacturer up. */
  supports(vendor: string): boolean;
  /** Resolve coverage. Throws {@link WarrantyProviderError} on transport/parse failure. */
  lookup(query: WarrantyLookupQuery): Promise<WarrantyLookupResult>;
}

/** Minimal `fetch` surface the HTTP providers use — lets tests inject a fake. */
export type WarrantyFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
