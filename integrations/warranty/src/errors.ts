/** Thrown when a provider lookup fails at transport or parse level. The sync
 *  service catches this per-CI and records the CI as `failed` — one bad asset
 *  never aborts the batch. */
export class WarrantyProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    /** HTTP status when the failure was a bad response; `undefined` for parse/network. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "WarrantyProviderError";
  }
}
