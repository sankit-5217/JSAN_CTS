import { ConfigService } from "@nestjs/config";
import { callbackUrl, readAuthConfig } from "./auth.config";

const cfg = (env: Record<string, string>) =>
  ({ get: (k: string) => env[k] }) as unknown as ConfigService;

describe("readAuthConfig", () => {
  it("enables only providers with both client id and secret", () => {
    const config = readAuthConfig(
      cfg({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs", GITHUB_CLIENT_ID: "only-id" }),
    );
    expect(config.providers.map((p) => p.id)).toEqual(["google"]);
  });

  it("builds callback URLs from the API's public origin", () => {
    const config = readAuthConfig(cfg({ API_PUBLIC_URL: "https://api.jsan.example/" }));
    expect(callbackUrl(config, "github")).toBe(
      "https://api.jsan.example/api/v1/auth/social/github/callback",
    );
  });

  it("uses a tenant-specific Microsoft issuer", () => {
    const config = readAuthConfig(
      cfg({
        MICROSOFT_CLIENT_ID: "m",
        MICROSOFT_CLIENT_SECRET: "ms",
        MICROSOFT_TENANT_ID: "11111111-2222-3333-4444-555555555555",
      }),
    );
    expect(config.providers[0]).toMatchObject({
      id: "microsoft",
      issuerUrl: "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0",
    });
  });

  it.each(["common", "organizations", ""])(
    "refuses Microsoft with tenant %j (any-tenant accounts could claim our users' emails)",
    (tenant) => {
      const config = readAuthConfig(
        cfg({
          MICROSOFT_CLIENT_ID: "m",
          MICROSOFT_CLIENT_SECRET: "ms",
          MICROSOFT_TENANT_ID: tenant,
        }),
      );
      expect(config.providers).toEqual([]);
      expect(config.rejected).toEqual([expect.objectContaining({ id: "microsoft" })]);
    },
  );

  it("supports GitHub Enterprise URLs", () => {
    const config = readAuthConfig(
      cfg({
        GITHUB_CLIENT_ID: "h",
        GITHUB_CLIENT_SECRET: "hs",
        GITHUB_WEB_URL: "https://ghe.jsan.example/",
        GITHUB_API_URL: "https://ghe.jsan.example/api/v3",
      }),
    );
    expect(config.providers[0]).toMatchObject({
      webUrl: "https://ghe.jsan.example",
      apiUrl: "https://ghe.jsan.example/api/v3",
    });
  });
});
