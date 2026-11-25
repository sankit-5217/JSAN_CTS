import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Encryption at rest for integration credentials kept in the database (e.g.
 * the Zabbix API token). AES-256-GCM with a 32-byte key from the
 * INTEGRATION_SECRETS_KEY env var (base64). The key itself never touches the
 * database, so a DB dump alone does not reveal any credential.
 *
 * Stored format: "v1:" + base64(iv[12] | authTag[16] | ciphertext).
 * The "v1" prefix leaves room for key rotation later.
 */

export const SECRETS_KEY_ENV = "INTEGRATION_SECRETS_KEY";
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretsKeyMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsKeyMissingError";
  }
}

export class SecretDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretDecryptError";
  }
}

/** Parses the env key. Throws SecretsKeyMissingError when unset or malformed. */
export function loadSecretsKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env[SECRETS_KEY_ENV]?.trim();
  if (!raw) {
    throw new SecretsKeyMissingError(
      `${SECRETS_KEY_ENV} is not set. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new SecretsKeyMissingError(
      `${SECRETS_KEY_ENV} must be 32 bytes, base64-encoded (got ${key.length} bytes)`,
    );
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

export function decryptSecret(stored: string, key: Buffer): string {
  const [version, payload] = stored.split(":", 2);
  if (version !== VERSION || !payload) {
    throw new SecretDecryptError("Unsupported secret format");
  }
  const buf = Buffer.from(payload, "base64");
  if (buf.length <= IV_BYTES + TAG_BYTES) {
    throw new SecretDecryptError("Stored secret is truncated");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key (rotated / different machine) or tampered ciphertext.
    throw new SecretDecryptError(
      `Stored secret could not be decrypted — was ${SECRETS_KEY_ENV} changed? Re-enter the credential.`,
    );
  }
}
