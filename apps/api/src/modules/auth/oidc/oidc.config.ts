import { ConfigService } from "@nestjs/config";

/**
 * SSO/OIDC settings (spec §7: "OIDC/OAuth2 via enterprise IdP; Keycloak for
 * dev"). Provider-neutral — everything comes from env + the issuer's
 * discovery document, so Entra ID / Okta / Keycloak are config-only swaps.
 */
export interface OidcConfig {
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  /** This API's callback URL, registered with the IdP as a redirect URI. */
  redirectUri: string;
  /** Web app origin the callback hands the browser back to. */
  webAppUrl: string;
  scopes: string;
  /** Button text on the login page, e.g. "Sign in with JSAN SSO". */
  providerLabel: string;
}

export function readOidcConfig(config: ConfigService): OidcConfig {
  const issuerUrl = config.get<string>("OIDC_ISSUER_URL", "");
  const clientId = config.get<string>("OIDC_CLIENT_ID", "");
  const clientSecret = config.get<string>("OIDC_CLIENT_SECRET", "");
  const redirectUri = config.get<string>("OIDC_REDIRECT_URI", "");
  // Explicit opt-in: the dev .env ships issuer/client values for the local
  // Keycloak, which shouldn't light up an SSO button when Keycloak isn't running.
  const enabled =
    config.get<string>("OIDC_ENABLED", "false") === "true" &&
    !!issuerUrl &&
    !!clientId &&
    !!redirectUri;
  return {
    enabled,
    issuerUrl,
    clientId,
    clientSecret,
    redirectUri,
    webAppUrl: config.get<string>("WEB_APP_URL", "http://localhost:5173").replace(/\/+$/, ""),
    scopes: config.get<string>("OIDC_SCOPES", "openid email profile"),
    providerLabel: config.get<string>("OIDC_PROVIDER_LABEL", "Sign in with SSO"),
  };
}
