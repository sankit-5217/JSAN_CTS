import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { BaseClient, Issuer, generators } from "openid-client";
import { OidcProviderConfig } from "../auth.config";
import { SocialIdentity, SocialProviderClient, SocialTransaction } from "./social-provider";

/**
 * Google / Microsoft sign-in: OIDC authorization code + PKCE via
 * openid-client, which validates the ID token (signature via the issuer's
 * JWKS, iss, aud, exp, nonce) and the state.
 */
export class OidcSocialClient implements SocialProviderClient {
  private readonly logger: Logger;
  private client: Promise<BaseClient> | null = null;

  constructor(
    private readonly config: OidcProviderConfig,
    private readonly redirectUri: string,
  ) {
    this.logger = new Logger(`OidcSocialClient:${config.id}`);
  }

  get id() {
    return this.config.id;
  }

  get label() {
    return this.config.label;
  }

  async startLogin(): Promise<{ url: string; tx: SocialTransaction }> {
    const client = await this.getClient();
    const tx: SocialTransaction = {
      provider: this.config.id,
      state: generators.state(),
      nonce: generators.nonce(),
      codeVerifier: generators.codeVerifier(),
    };
    const url = client.authorizationUrl({
      scope: this.config.scopes,
      state: tx.state,
      nonce: tx.nonce,
      code_challenge: generators.codeChallenge(tx.codeVerifier!),
      code_challenge_method: "S256",
      // Always let the person pick the account, rather than silently
      // reusing whichever Google/Microsoft account the browser is signed into.
      prompt: "select_account",
    });
    return { url, tx };
  }

  async completeLogin(
    params: Record<string, string>,
    tx: SocialTransaction,
  ): Promise<SocialIdentity> {
    const client = await this.getClient();
    const tokenSet = await client.callback(this.redirectUri, params, {
      state: tx.state,
      nonce: tx.nonce,
      code_verifier: tx.codeVerifier,
    });
    let claims: Record<string, unknown> & { iss: string; sub: string } = tokenSet.claims();
    // Some IdPs keep profile claims out of the ID token and only serve them
    // from userinfo (OIDC Core §5.4); openid-client rejects a userinfo `sub`
    // that differs from the ID token's.
    if (
      typeof claims.email !== "string" &&
      tokenSet.access_token &&
      client.issuer.metadata.userinfo_endpoint
    ) {
      claims = { ...(await client.userinfo(tokenSet)), iss: claims.iss, sub: claims.sub };
    }
    return {
      provider: this.config.id,
      issuer: claims.iss,
      subject: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
      emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : undefined,
      name: typeof claims.name === "string" ? claims.name : null,
    };
  }

  /** Lazy, cached discovery; a failed discovery is retried on the next call. */
  private getClient(): Promise<BaseClient> {
    if (!this.client) {
      this.client = Issuer.discover(this.config.issuerUrl)
        .then(
          (issuer) =>
            new issuer.Client({
              client_id: this.config.clientId,
              client_secret: this.config.clientSecret,
              redirect_uris: [this.redirectUri],
              response_types: ["code"],
              token_endpoint_auth_method: "client_secret_post",
            }),
        )
        .catch((err: unknown) => {
          this.client = null;
          this.logger.error(
            `discovery failed for ${this.config.issuerUrl}: ${err instanceof Error ? err.message : String(err)}`,
          );
          throw new ServiceUnavailableException(`${this.config.label} sign-in is unreachable`);
        });
    }
    return this.client;
  }
}
