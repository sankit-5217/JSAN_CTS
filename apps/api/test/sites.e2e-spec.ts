import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/** Site master data + site-scope enforcement over HTTP (spec §10.2, §12, acceptance scenario #7). */
describe("Sites API (e2e)", () => {
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

  it("SUPER_ADMIN creates a site; a non-admin role is forbidden (403)", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    const created = await t
      .http()
      .post("/api/v1/sites")
      .set("authorization", `Bearer ${admin}`)
      .send({ code: "E2E03", name: "E2E Third Site", timezone: "UTC" })
      .expect(201);
    expect(created.body.code).toBe("E2E03");

    const infra = await t.tokenFor(fx.users.infraLead.email);
    await t
      .http()
      .post("/api/v1/sites")
      .set("authorization", `Bearer ${infra}`)
      .send({ code: "E2E04", name: "Forbidden", timezone: "UTC" })
      .expect(403);
  });

  it("lists sites as a paginated envelope", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    const res = await t
      .http()
      .get("/api/v1/sites?limit=1&offset=0")
      .set("authorization", `Bearer ${admin}`)
      .expect(200);
    expect(res.body).toMatchObject({ limit: 1, offset: 0 });
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBe(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it("SiteScopeGuard: a scoped viewer can read a granted site but not a restricted one (403)", async () => {
    const viewer = await t.tokenFor(fx.users.ctsViewer.email); // granted only `site`, not `siteB`
    await t
      .http()
      .get(`/api/v1/sites/${fx.site.id}`)
      .set("authorization", `Bearer ${viewer}`)
      .expect(200);

    await t
      .http()
      .get(`/api/v1/sites/${fx.siteB.id}`)
      .set("authorization", `Bearer ${viewer}`)
      .expect(403);
  });

  it("creates a site contact and lists it", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    await t
      .http()
      .post(`/api/v1/sites/${fx.site.id}/contacts`)
      .set("authorization", `Bearer ${admin}`)
      .send({ name: "On-call Lead", role: "SITE_LEAD", email: "lead@example.com", isOnCall: true })
      .expect(201);

    const list = await t
      .http()
      .get(`/api/v1/sites/${fx.site.id}/contacts`)
      .set("authorization", `Bearer ${admin}`)
      .expect(200);
    expect(list.body.some((c: { name: string }) => c.name === "On-call Lead")).toBe(true);
  });
});
