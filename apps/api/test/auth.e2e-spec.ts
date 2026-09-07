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
});
