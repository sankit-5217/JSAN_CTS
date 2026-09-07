import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/** Command Center dashboard summary over HTTP (spec §10.1, §12). */
describe("Reports API (e2e)", () => {
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

  it("any authenticated role can read the command-center summary", async () => {
    const viewer = await t.tokenFor(fx.users.ctsViewer.email); // no @Roles restriction on this route
    const res = await t
      .http()
      .get("/api/v1/reports/command-center")
      .set("authorization", `Bearer ${viewer}`)
      .expect(200);
    expect(res.body).toHaveProperty("counters");
    expect(res.body).toHaveProperty("siteCards");
    expect(res.body).toHaveProperty("queues");
  });

  it("site-scopes siteCards: a scoped viewer sees only their granted site", async () => {
    const viewer = await t.tokenFor(fx.users.ctsViewer.email); // granted only `site`, not `siteB`
    const res = await t
      .http()
      .get("/api/v1/reports/command-center")
      .set("authorization", `Bearer ${viewer}`)
      .expect(200);
    const codes = res.body.siteCards.map((c: { code: string }) => c.code);
    expect(codes).toContain(fx.site.code);
    expect(codes).not.toContain(fx.siteB.code);

    const admin = await t.tokenFor(fx.users.superAdmin.email); // unrestricted
    const adminRes = await t
      .http()
      .get("/api/v1/reports/command-center")
      .set("authorization", `Bearer ${admin}`)
      .expect(200);
    const adminCodes = adminRes.body.siteCards.map((c: { code: string }) => c.code);
    expect(adminCodes).toContain(fx.siteB.code);
  });

  it("counters reflect a newly-created open incident (unassigned queue, NEW status)", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    await t
      .http()
      .post("/api/v1/incidents")
      .set("authorization", `Bearer ${admin}`)
      .send({
        siteId: fx.site.id,
        ciId: fx.ci.id,
        category: "HARDWARE_FAILURE",
        impact: "HIGH",
        urgency: "HIGH",
        priority: "P3",
        shortDescription: "Command-center counter coverage",
      })
      .expect(201);

    const res = await t
      .http()
      .get("/api/v1/reports/command-center")
      .set("authorization", `Bearer ${admin}`)
      .expect(200);
    expect(res.body.queues.unassigned).toBeGreaterThanOrEqual(1);
  });
});
