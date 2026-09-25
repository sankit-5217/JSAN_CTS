import { SsoService } from "../src/modules/auth/sso.service";
import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/** Identity/RBAC over HTTP (spec §4, §12): dev-login, JwtAuthGuard, RolesGuard. */
describe("Auth API (e2e)", () => {
  let t: TestApp;
  let fx: Fixture;

  beforeAll(async () => {
    t = await createTestApp();
    await resetSchema(t.prisma);
    fx = await seedFixture(t.prisma);
  });
  afterAll(async () => {
    await resetSchema(t.prisma);
    await t.close();
  });

  it("dev-login issues a usable bearer token for a seeded user", async () => {
    const res = await t
      .http()
      .post("/api/v1/auth/dev-login")
      .send({ email: fx.users.superAdmin.email })
      .expect(201);
    expect(typeof res.body.accessToken).toBe("string");

    // the token actually authenticates a follow-up request
    await t
      .http()
      .get("/api/v1/sites")
      .set("authorization", `Bearer ${res.body.accessToken}`)
      .expect(200);
  });

  it("rejects dev-login for an unknown email (401)", async () => {
    await t.http().post("/api/v1/auth/dev-login").send({ email: "nobody@example.com" }).expect(401);
  });

  it("rejects a protected route with no bearer token (401)", async () => {
    await t.http().get("/api/v1/sites").expect(401);
  });

  it("rejects a protected route with a garbage token (401)", async () => {
    await t.http().get("/api/v1/sites").set("authorization", "Bearer not-a-real-jwt").expect(401);
  });

  it("RolesGuard: a role outside the write set is forbidden (403), an included role is allowed", async () => {
    const engineer = await t.tokenFor(fx.users.siteEngineer.email); // not SUPER_ADMIN
    await t
      .http()
      .post("/api/v1/sites")
      .set("authorization", `Bearer ${engineer}`)
      .send({ code: "E2E99", name: "Should be forbidden", timezone: "UTC" })
      .expect(403);

    const admin = await t.tokenFor(fx.users.superAdmin.email);
    await t
      .http()
      .post("/api/v1/sites")
      .set("authorization", `Bearer ${admin}`)
      .send({ code: "E2E99", name: "Admin-created site", timezone: "UTC" })
      .expect(201);
  });

  describe("SSO (OIDC)", () => {
    it("advertises the available sign-in options without auth", async () => {
      const res = await t.http().get("/api/v1/auth/providers").expect(200);
      // e2e runs without OIDC_ENABLED, and NODE_ENV=test keeps dev-login on
      expect(res.body).toEqual({
        sso: { enabled: false, label: expect.any(String) },
        devLogin: true,
      });
    });

    it("login start bounces back to the web login page when SSO is disabled", async () => {
      const res = await t.http().get("/api/v1/auth/oidc/login").expect(302);
      expect(res.headers.location).toMatch(/\/login\?sso_error=sso_disabled$/);
    });

    it("callback without a transaction cookie is refused (no IdP call, no code)", async () => {
      const res = await t.http().get("/api/v1/auth/oidc/callback?code=x&state=y").expect(302);
      expect(res.headers.location).toMatch(/sso_error=invalid_state$/);
      expect(await t.prisma.ssoLoginCode.count()).toBe(0);
    });

    it("a login code is exchangeable exactly once, for a working access token", async () => {
      const code = await t.app.get(SsoService).createLoginCode(fx.users.superAdmin.id);

      const res = await t.http().post("/api/v1/auth/oidc/exchange").send({ code }).expect(201);
      await t
        .http()
        .get("/api/v1/sites")
        .set("authorization", `Bearer ${res.body.accessToken}`)
        .expect(200);

      await t.http().post("/api/v1/auth/oidc/exchange").send({ code }).expect(401);
    });

    it("rejects an unknown or malformed code", async () => {
      await t
        .http()
        .post("/api/v1/auth/oidc/exchange")
        .send({ code: "x".repeat(43) })
        .expect(401);
      await t.http().post("/api/v1/auth/oidc/exchange").send({ code: "short" }).expect(400);
    });

    it("first SSO login links a pre-provisioned user, later logins match by (issuer, subject)", async () => {
      const sso = t.app.get(SsoService);
      const email = fx.users.siteEngineer.email;
      const identity = {
        issuer: "https://idp.e2e.example/realms/opsdesk",
        subject: "kc-sub-engineer",
        email: email.toUpperCase(),
        emailVerified: true,
        name: null,
      };

      const first = await sso.resolveUser(identity);
      expect(first.id).toBe(fx.users.siteEngineer.id);
      const stored = await t.prisma.user.findUniqueOrThrow({ where: { id: first.id } });
      expect(stored).toMatchObject({ idpIssuer: identity.issuer, idpSubject: identity.subject });

      // IdP email changed later — the (issuer, subject) link still wins
      const again = await sso.resolveUser({ ...identity, email: "renamed@example.com" });
      expect(again.id).toBe(first.id);

      // a different IdP account claiming the same email is refused
      await expect(
        sso.resolveUser({ ...identity, subject: "kc-sub-imposter" }),
      ).rejects.toMatchObject({
        reason: "identity_mismatch",
      });

      const actions = await t.prisma.auditEvent.findMany({
        where: { entityType: "USER", action: { startsWith: "USER_" } },
        select: { action: true },
      });
      expect(actions.map((a) => a.action)).toEqual(
        expect.arrayContaining(["USER_IDP_LINKED", "USER_SSO_LOGIN", "USER_SSO_LOGIN_REJECTED"]),
      );
    });
  });
});
