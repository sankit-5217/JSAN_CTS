import {
  dummyPasswordHash,
  hashPassword,
  passwordPolicyProblem,
  verifyPassword,
} from "./password-hasher";

// scrypt is deliberately slow (~32 MiB, tens of ms per hash); under a fully
// parallel `pnpm test` on a busy machine the 5s default can be too tight.
jest.setTimeout(30_000);

describe("password hashing", () => {
  it("round-trips, and uses a fresh salt every time", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).toMatch(/^scrypt\$32768\$8\$3\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    await expect(verifyPassword("correct horse battery", a)).resolves.toBe(true);
    await expect(verifyPassword("correct horse batterY", a)).resolves.toBe(false);
  });

  it("never contains the password", async () => {
    expect(await hashPassword("super-secret-value")).not.toContain("super-secret-value");
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    await expect(verifyPassword("x", "")).resolves.toBe(false);
    await expect(verifyPassword("x", "bcrypt$abc")).resolves.toBe(false);
    await expect(verifyPassword("x", "scrypt$0$8$3$AAAA$AAAA")).resolves.toBe(false);
  });

  it("provides a stable dummy hash for unknown-user timing", async () => {
    const d = await dummyPasswordHash();
    expect(d).toBe(await dummyPasswordHash());
    await expect(verifyPassword("anything", d)).resolves.toBe(false);
  });
});

describe("passwordPolicyProblem", () => {
  const email = "priya.sharma@jsan.example";
  it.each([
    ["short", /at least 12/],
    ["x".repeat(129), /at most 128/],
    ["priya.sharma-2026!", /email name/],
    ["aaaaaaaaaaaaaa", /repeated/],
    ["Password1234", /too common/],
  ])("rejects %s", (pw, msg) => {
    expect(passwordPolicyProblem(pw, email)).toMatch(msg);
  });

  it("accepts a long passphrase", () => {
    expect(passwordPolicyProblem("rack four cable green", email)).toBeNull();
  });
});
