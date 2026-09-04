import { ConfigService } from "@nestjs/config";
import type { Provider } from "@nestjs/common";
import { createWarrantyProviders } from "@cts-dc-opsdesk/warranty-adapter";
import type { WarrantyProvider } from "@cts-dc-opsdesk/warranty-adapter";

/** DI token for the ordered list of {@link WarrantyProvider}s. */
export const WARRANTY_PROVIDERS = "WARRANTY_PROVIDERS";

/**
 * Builds the warranty provider list from config (spec: "configuration over
 * hard-code"). Real vendor providers are registered only when their API key is
 * present; the deterministic stub is added outside production (or when
 * `WARRANTY_STUB=1`) so local/demo environments still show coverage data —
 * in production an un-mapped vendor is reported as `skipped`, never faked.
 */
export const warrantyProvidersProvider: Provider = {
  provide: WARRANTY_PROVIDERS,
  inject: [ConfigService],
  useFactory: (config: ConfigService): WarrantyProvider[] => {
    const nodeEnv = config.get<string>("NODE_ENV") ?? "development";
    return createWarrantyProviders({
      dellApiKey: config.get<string>("DELL_WARRANTY_API_KEY"),
      dellBaseUrl: config.get<string>("DELL_WARRANTY_BASE_URL"),
      hpeApiKey: config.get<string>("HPE_WARRANTY_API_KEY"),
      hpeBaseUrl: config.get<string>("HPE_WARRANTY_BASE_URL"),
      enableStub: config.get<string>("WARRANTY_STUB") === "1" || nodeEnv !== "production",
    });
  },
};
