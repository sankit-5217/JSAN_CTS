import { randomBytes } from "crypto";
import { GithubProviderConfig } from "../auth.config";
import { SocialIdentity, SocialProviderClient, SocialTransaction } from "./social-provider";

const TIMEOUT_MS = 10_000;

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * GitHub sign-in. GitHub is plain OAuth2, not OIDC — there's no ID token, so
 * identity comes from the API with the access token: the numeric user id
 * (stable, unlike the login name) and the **primary, verified** email only.
 * The state check guards the callback; the client secret authenticates the
 * code exchange.
 */
export class GithubSocialClient implements SocialProviderClient {
  readonly id = "github" as const;

  constructor(
    private readonly config: GithubProviderConfig,
    private readonly redirectUri: string,
    private readonly http: typeof fetch = fetch,
  ) {}

  get label() {
    return this.config.label;
  }

  async startLogin(): Promise<{ url: string; tx: SocialTransaction }> {
    const tx: SocialTransaction = {
      provider: "github",
      state: randomBytes(24).toString("base64url"),
    };
    const url = new URL(`${this.config.webUrl}/login/oauth/authorize`);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.redirectUri,
      scope: "read:user user:email",
      state: tx.state,
      allow_signup: "false",
    }).toString();
    return { url: url.toString(), tx };
  }

  async completeLogin(
    params: Record<string, string>,
    tx: SocialTransaction,
  ): Promise<SocialIdentity> {
    if (!params.code || params.state !== tx.state) {
      throw new Error("GitHub callback is missing its code or has the wrong state");
    }

    const tokenRes = await this.http(`${this.config.webUrl}/login/oauth/access_token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: params.code,
        redirect_uri: this.redirectUri,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const token = (await tokenRes.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
    };
    if (!tokenRes.ok || !token.access_token) {
      throw new Error(`GitHub code exchange failed: ${token.error ?? tokenRes.status}`);
    }

    const [user, emails] = await Promise.all([
      this.api<{ id: number; login: string; name: string | null }>("/user", token.access_token),
      this.api<GithubEmail[]>("/user/emails", token.access_token),
    ]);
    if (typeof user.id !== "number") {
      throw new Error("GitHub /user returned no id");
    }
    const primary = Array.isArray(emails) ? emails.find((e) => e.primary) : undefined;

    return {
      provider: "github",
      issuer: this.config.webUrl,
      subject: String(user.id),
      email: primary?.email ?? null,
      emailVerified: primary ? primary.verified : undefined,
      name: user.name ?? user.login ?? null,
    };
  }

  private async api<T>(path: string, accessToken: string): Promise<T> {
    const res = await this.http(`${this.config.apiUrl}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "jsan-opsdesk",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`GitHub ${path} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
