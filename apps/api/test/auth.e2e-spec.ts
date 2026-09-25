import { JwtService } from "@nestjs/jwt";
import { PasswordAuthService } from "../src/modules/auth/password-auth.service";
import { SocialIdentityService } from "../src/modules/auth/social/social-identity.service";
import { createTestApp, TestApp } from "./app";
import { E2E_PASSWORD, Fixture, resetSchema, seedFixture } from "./fixture";

/** Identity/RBAC over HTTP (spec §4, §12, §17): sign-in paths, sessions, guards. */
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

  const login = (email: string, password: string) =>
    t.http().post("/api/v1/auth/login").send({ email, password });

  describe("password sign-in", () => {
    it("issues a usable bearer token and audits it", async () => {
      const res = await login(fx.users.superAdmin.email, E2E_PASSWORD).expect(200);
      await t
        .http()
        .get("/api/v1/sites")
        .set("authorization", `Bearer ${res.body.accessToken}`)
        .expect(200);
      expect(
        await t.prisma.auditEvent.count({
          where: { entityId: fx.users.superAdmin.id, action: "USER_PASSWORD_LOGIN" },
        }),
      ).toBeGreaterThan(0);
    });

    it("answers the same for a wrong password and an unknown email", async () => {
      const wrong = await login(fx.users.superAdmin.email, "not the password").expect(401);
      const unknown = await login("nobody@example.com", "not the password").expect(401);
      expect(wrong.body.message).toBe("Invalid email or password");
      expect(unknown.body.message).toBe(wrong.body.message);
    });

    it("the old email-only dev-login no longer exists", async () => {
      await t
        .http()
        .post("/api/v1/auth/dev-login")
        .send({ email: fx.users.superAdmin.email })
        .expect(404);
    });

    it("locks an account after 5 wrong passwords, even for the right one", async () => {
      const email = fx.users.auditor.email;
      for (let i = 0; i < 5; i++) await login(email, `wrong-${i}-password`).expect(401);
      const locked = await login(email, E2E_PASSWORD).expect(401);
      expect(locked.body.message).toMatch(/Too many failed attempts/);
      expect(
        await t.prisma.auditEvent.count({
          where: { entityId: fx.users.auditor.id, action: "USER_LOCKED_OUT" },
        }),
      ).toBe(1);
    });
  });

  describe("invite / reset links", () => {
    it("forgot-password answers the same for unknown emails and creates no link", async () => {
      const res = await t
        .http()
        .post("/api/v1/auth/password/forgot")
        .send({ email: "nobody@example.com" })
        .expect(202);
      expect(res.body.message).toMatch(/If that email has an OpsDesk account/);
      expect(await t.prisma.passwordToken.count()).toBe(0);
    });

    it("an admin invite lets a new user choose a password, once, and signs them in", async () => {
      const admin = await t.tokenFor(fx.users.superAdmin.email);
      const created = await t
        .http()
        .post("/api/v1/admin/users")
        .set("authorization", `Bearer ${admin}`)
        .send({ email: "invitee@example.com", displayName: "Invitee", role: "SERVICE_DESK_NOC" })
        .expect(201);
      // no Redis in e2e -> not emailed, but the admin gets the link to share
      expect(created.body.invite).toMatchObject({ purpose: "INVITE", emailQueued: false });
      const link: string = created.body.invite.link;
      expect(link).toMatch(/^http:\/\/web\.e2e\.test\/auth\/set-password#token=/);
      const token = link.split("#token=")[1];

      // no password yet -> can't sign in
      await login("invitee@example.com", "whatever-password").expect(401);

      const info = await t.http().post("/api/v1/auth/password/inspect").send({ token }).expect(200);
      expect(info.body).toEqual({
        email: "invitee@example.com",
        displayName: "Invitee",
        purpose: "INVITE",
      });

      await t
        .http()
        .post("/api/v1/auth/password/set")
        .send({ token, password: "short" })
        .expect(400);
      const set = await t
        .http()
        .post("/api/v1/auth/password/set")
        .send({ token, password: "a long enough passphrase" })
        .expect(200);
      await t
        .http()
        .get("/api/v1/sites")
        .set("authorization", `Bearer ${set.body.accessToken}`)
        .expect(200);

      // single-use
      await t
        .http()
        .post("/api/v1/auth/password/set")
        .send({ token, password: "another long passphrase" })
        .expect(400);
      await login("invitee@example.com", "a long enough passphrase").expect(200);
    });

    it("a password reset signs out the user's existing sessions", async () => {
      const email = fx.users.infraLead.email;
      const oldSession = await t.tokenFor(email);
      await t.http().post("/api/v1/auth/password/forgot").send({ email }).expect(202);

      // the self-service link is only ever emailed (no Redis here), so issue a
      // fresh one the same way to get a usable token
      const { link } = await t.app
        .get(PasswordAuthService)
        .sendSignInLink(fx.users.infraLead.id, { actorId: null });
      const token = link.split("#token=")[1];
      await t
        .http()
        .post("/api/v1/auth/password/set")
        .send({ token, password: "rotated passphrase 2026" })
        .expect(200);

      await t.http().get("/api/v1/sites").set("authorization", `Bearer ${oldSession}`).expect(401);
      await login(email, E2E_PASSWORD).expect(401);
      await login(email, "rotated passphrase 2026").expect(200);
    });
  });

  describe("sessions and guards", () => {
    it("rejects a protected route with no or a garbage token (401)", async () => {
      await t.http().get("/api/v1/sites").expect(401);
      await t.http().get("/api/v1/sites").set("authorization", "Bearer not-a-real-jwt").expect(401);
    });

    it("rejects a correctly signed token without a session version (old dev-login tokens)", async () => {
      const legacy = t.app.get(JwtService).sign({
        sub: fx.users.superAdmin.id,
        email: fx.users.superAdmin.email,
        role: "SUPER_ADMIN",
      });
      await t.http().get("/api/v1/sites").set("authorization", `Bearer ${legacy}`).expect(401);
    });

    it("RolesGuard: a role outside the write set is forbidden (403), an included role is allowed", async () => {
      const engineer = await t.tokenFor(fx.users.siteEngineer.email);
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
  });

  describe("machine API tokens", () => {
    it("act as their user until revoked; the value is only shown at creation", async () => {
      const admin = await t.tokenFor(fx.users.superAdmin.email);
      const svcUser = fx.users.serviceDesk;
      const created = await t
        .http()
        .post(`/api/v1/admin/users/${svcUser.id}/api-tokens`)
        .set("authorization", `Bearer ${admin}`)
        .send({ name: "E2E collector", expiresInDays: 30 })
        .expect(201);
      const apiToken: string = created.body.token;
      expect(apiToken).toMatch(/^odk_/);

      const listed = await t
        .http()
        .get(`/api/v1/admin/users/${svcUser.id}/api-tokens`)
        .set("authorization", `Bearer ${admin}`)
        .expect(200);
      expect(JSON.stringify(listed.body)).not.toContain(apiToken);

      await t.http().get("/api/v1/sites").set("authorization", `Bearer ${apiToken}`).expect(200);
      // it carries its user's role: service desk can't create sites
      await t
        .http()
        .post("/api/v1/sites")
        .set("authorization", `Bearer ${apiToken}`)
        .send({ code: "E2E98", name: "x", timezone: "UTC" })
        .expect(403);

      await t
        .http()
        .post(`/api/v1/admin/users/${svcUser.id}/api-tokens/${created.body.id}/revoke`)
        .set("authorization", `Bearer ${admin}`)
        .expect(200);
      await t.http().get("/api/v1/sites").set("authorization", `Bearer ${apiToken}`).expect(401);
    });

    it("an unknown odk_ token is a 401", async () => {
      await t
        .http()
        .get("/api/v1/sites")
        .set("authorization", `Bearer odk_${"x".repeat(43)}`)
        .expect(401);
    });
  });

  describe("social sign-in", () => {
    it("advertises password sign-in and no social providers when none are configured", async () => {
      const res = await t.http().get("/api/v1/auth/providers").expect(200);
      expect(res.body).toEqual({ password: true, social: [] });
    });

    it("an unconfigured provider bounces back to the login page", async () => {
      const res = await t.http().get("/api/v1/auth/social/google/login").expect(302);
      expect(res.headers.location).toBe("http://web.e2e.test/login?social_error=provider_disabled");
    });

    it("a handoff code is exchangeable exactly once, for a working access token", async () => {
      const code = await t.app.get(SocialIdentityService).createHandoffCode(fx.users.superAdmin.id);
      const res = await t.http().post("/api/v1/auth/social/exchange").send({ code }).expect(201);
      await t
        .http()
        .get("/api/v1/sites")
        .set("authorization", `Bearer ${res.body.accessToken}`)
        .expect(200);
      await t.http().post("/api/v1/auth/social/exchange").send({ code }).expect(401);
    });

    it("links a verified email to the existing user, then trusts only the linked identity", async () => {
      const identities = t.app.get(SocialIdentityService);
      const id = {
        provider: "github" as const,
        issuer: "https://github.com",
        subject: "424242",
        email: fx.users.siteEngineer.email.toUpperCase(),
        emailVerified: true,
        name: null,
      };
      const first = await identities.resolveUser(id);
      expect(first.id).toBe(fx.users.siteEngineer.id);
      // GitHub email changed later — the link still wins
      await expect(
        identities.resolveUser({ ...id, email: "renamed@example.com" }),
      ).resolves.toMatchObject({
        id: fx.users.siteEngineer.id,
      });
      // a different GitHub account claiming the same email is refused
      await expect(identities.resolveUser({ ...id, subject: "999" })).rejects.toMatchObject({
        reason: "identity_mismatch",
      });
      // a Google account for the same person links alongside it
      await expect(
        identities.resolveUser({
          ...id,
          provider: "google",
          issuer: "https://accounts.google.com",
          subject: "g-1",
        }),
      ).resolves.toMatchObject({ id: fx.users.siteEngineer.id });
      expect(
        await t.prisma.userIdentity.count({ where: { userId: fx.users.siteEngineer.id } }),
      ).toBe(2);
    });
  });
});
