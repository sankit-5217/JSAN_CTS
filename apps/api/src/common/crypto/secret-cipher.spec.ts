import { randomBytes } from "crypto";
import {
  SECRETS_KEY_ENV,
  SecretDecryptError,
  SecretsKeyMissingError,
  decryptSecret,
  encryptSecret,
  loadSecretsKey,
} from "./secret-cipher";

describe("secret-cipher", () => {
  const key = randomBytes(32);

  it("round-trips a secret", () => {
    const stored = encryptSecret("zbx-token-abc123", key);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("zbx-token-abc123");
    expect(decryptSecret(stored, key)).toBe("zbx-token-abc123");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("rejects a different key", () => {
    const stored = encryptSecret("secret", key);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow(SecretDecryptError);
  });

  it("rejects tampered ciphertext", () => {
    const stored = encryptSecret("secret", key);
    const raw = Buffer.from(stored.slice(3), "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => decryptSecret(`v1:${raw.toString("base64")}`, key)).toThrow(SecretDecryptError);
  });

  it("rejects unknown formats", () => {
    expect(() => decryptSecret("plain-text", key)).toThrow(SecretDecryptError);
    expect(() => decryptSecret("v1:AAAA", key)).toThrow(SecretDecryptError);
  });

  describe("loadSecretsKey", () => {
    it("loads a 32-byte base64 key", () => {
      const b64 = key.toString("base64");
      expect(loadSecretsKey({ [SECRETS_KEY_ENV]: b64 }).equals(key)).toBe(true);
    });

    it("throws when unset", () => {
      expect(() => loadSecretsKey({})).toThrow(SecretsKeyMissingError);
    });

    it("throws on a wrong-length key", () => {
      expect(() =>
        loadSecretsKey({ [SECRETS_KEY_ENV]: randomBytes(16).toString("base64") }),
      ).toThrow(SecretsKeyMissingError);
    });
  });
});
