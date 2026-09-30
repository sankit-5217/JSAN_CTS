import { randomBytes, scrypt, timingSafeEqual } from "crypto";

/**
 * Password hashing with scrypt (Node's built-in: no native dependency to
 * compile in Docker/Windows). Parameters follow OWASP's scrypt guidance
 * (N=2^15, r=8, p=3 ≈ 32 MiB per hash). Encoded self-describingly so the
 * cost can be raised later without breaking stored hashes:
 *
 *   scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>
 */
const N = 2 ** 15;
const R = 8;
const P = 3;
const KEY_LEN = 64;
const SALT_LEN = 16;
const MAX_MEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, { N: n, r, p, maxmem: MAX_MEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await derive(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (!n || !r || !p || expected.length !== KEY_LEN) return false;
  const actual = await derive(password, salt, n, r, p);
  return timingSafeEqual(actual, expected);
}

/** A real hash of a random value — verified against when the email is
 *  unknown, so "no such user" costs the same time as "wrong password". */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Returns what's wrong with a new password, or null. Length over character
 * classes (NIST SP 800-63B), plus the obvious personal-information check.
 */
export function passwordPolicyProblem(password: string, email: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  const lower = password.toLowerCase();
  const localPart = email.split("@")[0]?.toLowerCase() ?? "";
  if (localPart.length >= 3 && lower.includes(localPart)) {
    return "Don't include your email name in your password";
  }
  if (/^(.)\1+$/.test(password)) {
    return "Don't use a single repeated character";
  }
  if (COMMON_PASSWORDS.has(lower)) {
    return "That password is too common";
  }
  return null;
}

// A few of the most-used passwords that clear the length rule.
const COMMON_PASSWORDS = new Set([
  "password1234",
  "password12345",
  "password123456",
  "123456789012",
  "qwertyuiop12",
  "qwerty123456",
  "iloveyou1234",
  "welcome12345",
  "adminadmin12",
  "letmein12345",
  "changeme1234",
  "p@ssw0rd1234",
]);
