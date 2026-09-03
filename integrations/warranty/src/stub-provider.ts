import type { WarrantyLookupQuery, WarrantyLookupResult, WarrantyProvider } from "./types";

/** FNV-1a — small, stable, dependency-free. Only used to make the stub's
 *  answers deterministic per service tag, never for anything security-sensitive. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const DAY_MS = 86_400_000;

export interface StubWarrantyProviderOptions {
  /** Fixed "now" for reproducible tests; defaults to the real clock. */
  now?: () => Date;
}

/**
 * A provider with no external dependency. It fabricates a *stable* coverage
 * result from the service tag so local/demo environments show consistent,
 * plausible warranty data before the real Dell/HPE API keys exist.
 *
 * NEVER enable this in production — a fake "ACTIVE" would mask a genuinely
 * expired warranty. `createWarrantyProviders` only includes it when explicitly
 * asked (`enableStub`) or outside production.
 */
export class StubWarrantyProvider implements WarrantyProvider {
  readonly name = "stub";
  private readonly now: () => Date;

  constructor(opts: StubWarrantyProviderOptions = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  /** The stub is a catch-all fallback — it answers for any manufacturer. */
  supports(): boolean {
    return true;
  }

  async lookup(query: WarrantyLookupQuery): Promise<WarrantyLookupResult> {
    const seed = hash(`${query.vendor.toUpperCase()}:${query.serialOrServiceTag}`);
    // ~1 in 6 assets read as already expired; the rest expire 30–1125 days out.
    const expired = seed % 6 === 0;
    const offsetDays = expired ? -((seed % 400) + 1) : (seed % 1096) + 30;
    const expiresAt = new Date(this.now().getTime() + offsetDays * DAY_MS);
    const levels = ["Basic Hardware Service", "ProSupport", "ProSupport Plus", "Foundation Care"];
    return {
      status: expired ? "EXPIRED" : "ACTIVE",
      provider: this.name,
      expiresAt: expiresAt.toISOString(),
      coverageLevel: levels[seed % levels.length],
    };
  }
}
