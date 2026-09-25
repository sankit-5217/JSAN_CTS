import { ConfigService } from "@nestjs/config";

export type SocialProviderId = "google" | "microsoft" | "github";

export interface OidcProviderConfig {
  id: "google" | "microsoft";
  kind: "oidc";
  label: string;
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  scopes: string;
}

export interface GithubProviderConfig {
  id: "github";
  kind: "github";
  label: string;
  clientId: string;
  clientSecret: string;
  /** https://github.com, or a GitHub Enterprise Server origin. */
  webUrl: string;
  /** https://api.github.com, or https://<ghes-host>/api/v3. */
  apiUrl: string;
}

export type SocialProviderConfig = OidcProviderConfig | GithubProviderConfig;

export interface AuthConfig {
  /** The web app's origin — where sign-in links and social callbacks land. */
  webAppUrl: string;
  /**
   * This API's public origin, used to build social callback URLs
   * (`<apiPublicUrl>/api/v1/auth/social/<provider>/callback`). Must be the same
   * host the web app calls the API on (VITE_API_BASE_URL): the sign-in
   * cookie is scoped to it.
   */
  apiPublicUrl: string;
  providers: SocialProviderConfig[];
  /** Providers configured but refused (e.g. an unsafe Microsoft tenant), with why. */
  rejected: { id: SocialProviderId; reason: string }[];
}

/**
 * Microsoft "common"/"organizations" would accept accounts from *any*
 * Entra tenant, whose admins can set a user's email to anything — letting
 * them sign in as one of our users by email ("nOAuth"). Only a specific
 * tenant (JSAN's GUID) or "consumers" (personal accounts, where Microsoft
 * verifies the email) is safe for email-based account matching.
 */
const UNSAFE_MICROSOFT_TENANTS = new Set(["common", "organizations"]);

export function callbackUrl(config: AuthConfig, provider: SocialProviderId): string {
  return `${config.apiPublicUrl}/api/v1/auth/social/${provider}/callback`;
}

export function readAuthConfig(config: ConfigService): AuthConfig {
  const get = (key: string, fallback = "") => (config.get<string>(key) ?? fallback).trim();
  const providers: SocialProviderConfig[] = [];
  const rejected: AuthConfig["rejected"] = [];

  if (get("GOOGLE_CLIENT_ID") && get("GOOGLE_CLIENT_SECRET")) {
    providers.push({
      id: "google",
      kind: "oidc",
      label: "Google",
      clientId: get("GOOGLE_CLIENT_ID"),
      clientSecret: get("GOOGLE_CLIENT_SECRET"),
      issuerUrl: "https://accounts.google.com",
      scopes: "openid email profile",
    });
  }

  if (get("MICROSOFT_CLIENT_ID") && get("MICROSOFT_CLIENT_SECRET")) {
    const tenant = get("MICROSOFT_TENANT_ID");
    if (!tenant) {
      rejected.push({ id: "microsoft", reason: "MICROSOFT_TENANT_ID is not set" });
    } else if (UNSAFE_MICROSOFT_TENANTS.has(tenant.toLowerCase())) {
      rejected.push({
        id: "microsoft",
        reason: `MICROSOFT_TENANT_ID=${tenant} would accept accounts from any tenant; use your tenant ID or "consumers"`,
      });
    } else {
      providers.push({
        id: "microsoft",
        kind: "oidc",
        label: "Microsoft",
        clientId: get("MICROSOFT_CLIENT_ID"),
        clientSecret: get("MICROSOFT_CLIENT_SECRET"),
        issuerUrl: `https://login.microsoftonline.com/${tenant}/v2.0`,
        scopes: "openid email profile",
      });
    }
  }

  if (get("GITHUB_CLIENT_ID") && get("GITHUB_CLIENT_SECRET")) {
    providers.push({
      id: "github",
      kind: "github",
      label: "GitHub",
      clientId: get("GITHUB_CLIENT_ID"),
      clientSecret: get("GITHUB_CLIENT_SECRET"),
      webUrl: get("GITHUB_WEB_URL", "https://github.com").replace(/\/+$/, ""),
      apiUrl: get("GITHUB_API_URL", "https://api.github.com").replace(/\/+$/, ""),
    });
  }

  return {
    webAppUrl: get("WEB_APP_URL", "http://localhost:5173").replace(/\/+$/, ""),
    apiPublicUrl: get("API_PUBLIC_URL", "http://localhost:3000").replace(/\/+$/, ""),
    providers,
    rejected,
  };
}
