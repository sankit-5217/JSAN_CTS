import { DellWarrantyProvider } from "./dell-provider";
import { HpeWarrantyProvider } from "./hpe-provider";
import { StubWarrantyProvider } from "./stub-provider";
import type { WarrantyProvider } from "./types";

/** First provider in the list that claims the vendor, or `undefined`. Order is
 *  significant: real providers are registered before the catch-all stub. */
export function resolveWarrantyProvider(
  providers: readonly WarrantyProvider[],
  vendor: string,
): WarrantyProvider | undefined {
  return providers.find((p) => p.supports(vendor));
}

export interface WarrantyProviderEnv {
  /** Dell Warranty API bearer token; enables {@link DellWarrantyProvider} when set. */
  dellApiKey?: string;
  dellBaseUrl?: string;
  /** HPE Warranty API bearer token; enables {@link HpeWarrantyProvider} when set. */
  hpeApiKey?: string;
  hpeBaseUrl?: string;
  /**
   * Include the deterministic {@link StubWarrantyProvider} as a catch-all.
   * Intended for dev/demo only — never in production, where an un-mapped
   * vendor should surface as "skipped" rather than get fabricated coverage.
   */
  enableStub?: boolean;
}

/**
 * Build the ordered provider list from configuration. Real vendor providers
 * come first (so they win for their manufacturer); the stub, when enabled, is
 * last and answers for everything else.
 */
export function createWarrantyProviders(env: WarrantyProviderEnv): WarrantyProvider[] {
  const providers: WarrantyProvider[] = [];
  if (env.dellApiKey) {
    providers.push(
      new DellWarrantyProvider({ apiKey: env.dellApiKey, baseUrl: env.dellBaseUrl }),
    );
  }
  if (env.hpeApiKey) {
    providers.push(new HpeWarrantyProvider({ apiKey: env.hpeApiKey, baseUrl: env.hpeBaseUrl }));
  }
  if (env.enableStub) {
    providers.push(new StubWarrantyProvider());
  }
  return providers;
}
