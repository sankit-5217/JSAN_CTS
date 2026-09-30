import { SocialProviderId } from "../auth.config";

/** Per-login secrets kept in the signed transaction cookie between /login and /callback. */
export interface SocialTransaction {
  provider: SocialProviderId;
  state: string;
  nonce?: string;
  codeVerifier?: string;
}

/** The identity a provider vouched for, after its own token/signature checks. */
export interface SocialIdentity {
  provider: SocialProviderId;
  /** Stable namespace for `subject` (the OIDC issuer; "https://github.com" for GitHub). */
  issuer: string;
  subject: string;
  email: string | null;
  /** undefined = the provider didn't say. */
  emailVerified: boolean | undefined;
  name: string | null;
}

/** One social sign-in provider: build the redirect, then turn the callback into an identity. */
export interface SocialProviderClient {
  readonly id: SocialProviderId;
  readonly label: string;
  startLogin(): Promise<{ url: string; tx: SocialTransaction }>;
  /** Throws on any failed check (state, code exchange, token validation, missing data). */
  completeLogin(params: Record<string, string>, tx: SocialTransaction): Promise<SocialIdentity>;
}
