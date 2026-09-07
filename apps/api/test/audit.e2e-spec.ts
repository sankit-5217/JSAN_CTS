import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/** Authorized audit search over HTTP (spec §14.1, §12) -- new read endpoint. */
describe("Audit API (e2e)", () => {
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

  it("only SUPER_ADMIN/AUDITOR_READ_ONLY can read the audit trail (403 for others, 200 for those roles)", async () => {
    const engineer = await t.tokenFor(fx.users.siteEngineer.email);
    await t.http().get("/api/v1/audit").set("authorization", `Bearer ${engineer}`).expect(403);

    const auditor = await t.tokenFor(fx.users.auditor.email);
    await t.http().get("/api/v1/audit").set("authorization", `Bearer ${auditor}`).expect(200);

    const admin = await t.tokenFor(fx.users.superAdmin.email);
    await t.http().get("/api/v1/audit").set("authorization", `Bearer ${admin}`).expect(200);
  });

  it("reconstructs an entity's timeline via entityType/entityId filters, newest first", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    const site = await t
      .http()
      .post("/api/v1/sites")
      .set("authorization", `Bearer ${admin}`)
      .send({ code: "E2E-AUDIT", name: "Audit trail site", timezone: "UTC" })
      .expect(201);

    const auditor = await t.tokenFor(fx.users.auditor.email);
    const trail = await t
      .http()
      .get(`/api/v1/audit?entityType=Site&entityId=${site.body.id}`)
      .set("authorization", `Bearer ${auditor}`)
      .expect(200);

    expect(trail.body.items.length).toBeGreaterThanOrEqual(1);
    expect(trail.body.items[0]).toMatchObject({
      entityType: "Site",
      entityId: site.body.id,
      action: "CREATE",
    });
  });

  it("paginates and supports an actorId filter", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    await t
      .http()
      .post("/api/v1/sites")
      .set("authorization", `Bearer ${admin}`)
      .send({ code: "E2E-AUDIT2", name: "Second audit site", timezone: "UTC" })
      .expect(201);

    const auditor = await t.tokenFor(fx.users.auditor.email);
    const res = await t
      .http()
      .get(`/api/v1/audit?actorId=${fx.users.superAdmin.id}&limit=1&offset=0`)
      .set("authorization", `Bearer ${auditor}`)
      .expect(200);
    expect(res.body).toMatchObject({ limit: 1, offset: 0 });
    expect(res.body.items.length).toBe(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });
});
