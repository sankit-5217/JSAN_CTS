/**
 * Resolves an endpoint's `credentialRef` (a name) to the actual username /
 * password. The collector never stores central credentials — only scoped
 * per-endpoint ones from a local secret store (ADR-004). The env resolver here
 * is the dev/default backing; a real deployment points this at a vault client.
 */

export interface Credential {
  username: string;
  password: string;
}

export interface CredentialResolver {
  resolve(ref: string): Credential | undefined;
}

/**
 * Reads `COLLECTOR_CRED_<REF>` = `"username:password"` from the environment
 * (`<REF>` upper-cased, non-alphanumerics -> `_`). Password may itself contain
 * `:` — only the first is the separator.
 */
export class EnvCredentialResolver implements CredentialResolver {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  resolve(ref: string): Credential | undefined {
    const key = `COLLECTOR_CRED_${ref.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
    const raw = this.env[key];
    if (!raw) {
      return undefined;
    }
    const sep = raw.indexOf(":");
    if (sep < 1) {
      return undefined;
    }
    return { username: raw.slice(0, sep), password: raw.slice(sep + 1) };
  }
}
