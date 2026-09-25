import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BaseClient, Issuer, generators } from "openid-client";
import { OidcConfig, readOidcConfig } from "./oidc.config";

/** Per-login secrets kept in the signed transaction cookie between /login and /callback. */
export interface OidcTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** The identity the IdP vouched for, after ID-token signature/iss/aud/nonce/exp checks. */
export interface OidcIdentity {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean | undefined;
  name: string | null;
}

/**
 * Thin wrapper over openid-client: discovery, the authorization-code +
 * PKCE redirect, and the code exchange. Holds no user/business logic —
 * AuthService decides who (if anyone) the verified identity maps to.
 */
@Injectable()
export class OidcClientService {
  private readonly logger = new Logger(OidcClientService.name);
  readonly config: OidcConfig;
  private client: Promise<BaseClient> | null = null;

  constructor(configService: ConfigService) {
    this.config = readOidcConfig(configService);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Builds the IdP redirect and the secrets the callback must see again. */
  async startLogin(): Promise<{ url: string; tx: OidcTransaction }> {
    const client = await this.getClient();
    const tx: OidcTransaction = {
      state: generators.state(),
      nonce: generators.nonce(),
      codeVerifier: generators.codeVerifier(),
    };
    const url = client.authorizationUrl({
      scope: this.config.scopes,
      state: tx.state,
      nonce: tx.nonce,
      code_challenge: generators.codeChallenge(tx.codeVerifier),
      code_challenge_method: "S256",
    });
    return { url, tx };
  }

  /**
   * Exchanges the authorization code and validates the ID token (signature
   * via the issuer's JWKS, iss, aud, exp, nonce, state). Throws on any
   * mismatch — callers treat every throw as "login rejected".
   */
  async completeLogin(
    callbackParams: Record<string, string>,
    tx: OidcTransaction,
  ): Promise<OidcIdentity> {
    const client = await this.getClient();
    const tokenSet = await client.callback(this.config.redirectUri, callbackParams, {
      state: tx.state,
      nonce: tx.nonce,
      code_verifier: tx.codeVerifier,
    });
    let claims: Record<string, unknown> & { iss: string; sub: string } = tokenSet.claims();
    // Some IdPs keep profile claims out of the ID token and only serve them
    // from userinfo (allowed by OIDC Core §5.4). openid-client rejects a
    // userinfo response whose `sub` differs from the ID token's.
    if (
      typeof claims.email !== "string" &&
      tokenSet.access_token &&
      client.issuer.metadata.userinfo_endpoint
    ) {
      claims = { ...(await client.userinfo(tokenSet)), iss: claims.iss, sub: claims.sub };
    }
    return {
      issuer: claims.iss,
      subject: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
      emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : undefined,
      name: typeof claims.name === "string" ? claims.name : null,
    };
  }

  /** RP-initiated logout URL, or null when the IdP doesn't advertise one. */
  async logoutUrl(postLogoutRedirectUri: string): Promise<string | null> {
    const client = await this.getClient();
    if (!client.issuer.metadata.end_session_endpoint) return null;
    return client.endSessionUrl({
      client_id: this.config.clientId,
      post_logout_redirect_uri: postLogoutRedirectUri,
    });
  }

  /** Lazy, cached discovery; a failed discovery is retried on the next call. */
  private getClient(): Promise<BaseClient> {
    if (!this.config.enabled) {
      return Promise.reject(new ServiceUnavailableException("SSO is not configured"));
    }
    if (!this.client) {
      this.client = Issuer.discover(this.config.issuerUrl)
        .then(
          (issuer) =>
            new issuer.Client({
              client_id: this.config.clientId,
              client_secret: this.config.clientSecret || undefined,
              redirect_uris: [this.config.redirectUri],
              response_types: ["code"],
              token_endpoint_auth_method: this.config.clientSecret ? "client_secret_basic" : "none",
            }),
        )
        .catch((err: unknown) => {
          this.client = null;
          this.logger.error(
            `OIDC discovery failed for ${this.config.issuerUrl}: ${err instanceof Error ? err.message : String(err)}`,
          );
          throw new ServiceUnavailableException("SSO provider is unreachable");
        });
    }
    return this.client;
  }
}
