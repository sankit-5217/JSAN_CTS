import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/**
 * The go-live hardening for Railway, over HTTP against the real database:
 * a health check that means something, site-scoped monitoring reads (a
 * client sees only its own sites, never vendor data), and collector
 * heartbeats kept out of the audit trail.
 */
describe("Deploy hardening (e2e)", () => {
  let t: TestApp;
  let fx: Fixture;
  let alertA: string;
  let alertB: string;
  let ciB: string;

  beforeAll(async () => {
    t = await createTestApp();
    await resetSchema(t.prisma);
    fx = await seedFixture(t.prisma);

    const rackB = await t.prisma.rack.create({
      data: { siteId: fx.siteB.id, rackCode: "R01", name: "E2E Rack B01" },
    });
    const ci = await t.prisma.configurationItem.create({
      data: {
        ciCode: "E2E02-R01-UPS-001",
        siteId: fx.siteB.id,
        rackId: rackB.id,
        ciType: "UPS",
        name: "E2E UPS B",
        managedBy: "JSAN",
        criticality: "HIGH",
        lifecycleStatus: "ACTIVE",
      },
    });
    ciB = ci.ciCode;
    const alert = (siteId: string, ciId: string, externalEventId: string) =>
      t.prisma.alert.create({
        data: {
          externalEventId,
          source: "ZABBIX",
          siteId,
          ciId,
          alertType: "ups.on_battery",
          severity: "HIGH",
          fingerprint: externalEventId,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
      });
    alertA = (await alert(fx.site.id, fx.ci.id, "zbx-e2e-a")).id;
    alertB = (await alert(fx.siteB.id, ci.id, "zbx-e2e-b")).id;
    await t.prisma.healthSnapshot.create({
      data: { ciId: ci.id, overallHealth: "HEALTHY" },
    });
    const vendor = await t.prisma.vendor.create({ data: { name: "E2E Vendor", type: "OEM" } });
    await t.prisma.vendorCase.create({
      data: { vendorCaseNo: "VC-E2E-B", vendorId: vendor.id, ciId: ci.id },
    });
  });
  afterAll(async () => {
    await resetSchema(t.prisma);
    await t.close();
  });

  it("health check answers only when the database is reachable", async () => {
    const res = await t.http().get("/api/v1/health").expect(200);
    expect(res.body).toMatchObject({ status: "ok", database: "ok" });
    await t.http().get("/api/v1/health/live").expect(200);
  });

  it("a client sees only its own sites' alerts", async () => {
    const viewer = await t.tokenFor(fx.users.clientViewer.email); // granted fx.site only
    const list = await t
      .http()
      .get("/api/v1/alerts")
      .set("authorization", `Bearer ${viewer}`)
      .expect(200);
    const ids = list.body.map((a: { id: string }) => a.id);
    expect(ids).toContain(alertA);
    expect(ids).not.toContain(alertB);
    await t
      .http()
      .get(`/api/v1/alerts/${alertB}`)
      .set("authorization", `Bearer ${viewer}`)
      .expect(404);
    await t
      .http()
      .get(`/api/v1/alerts/${alertA}`)
      .set("authorization", `Bearer ${viewer}`)
      .expect(200);
  });

  it("an all-sites role still sees every alert", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    const list = await t
      .http()
      .get("/api/v1/alerts")
      .set("authorization", `Bearer ${admin}`)
      .expect(200);
    const ids = list.body.map((a: { id: string }) => a.id);
    expect(ids).toEqual(expect.arrayContaining([alertA, alertB]));
  });

  it("a client can't read another site's hardware health", async () => {
    const viewer = await t.tokenFor(fx.users.clientViewer.email);
    await t
      .http()
      .get(`/api/v1/monitoring/health-snapshots/${ciB}`)
      .set("authorization", `Bearer ${viewer}`)
      .expect(404);
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    await t
      .http()
      .get(`/api/v1/monitoring/health-snapshots/${ciB}`)
      .set("authorization", `Bearer ${admin}`)
      .expect(200);
  });

  it("a client never reads vendors or vendor cases", async () => {
    const viewer = await t.tokenFor(fx.users.clientViewer.email);
    for (const path of ["/api/v1/vendor-cases", "/api/v1/vendors"]) {
      await t.http().get(path).set("authorization", `Bearer ${viewer}`).expect(403);
    }
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    const cases = await t
      .http()
      .get("/api/v1/vendor-cases")
      .set("authorization", `Bearer ${admin}`)
      .expect(200);
    expect(cases.body.map((c: { vendorCaseNo: string }) => c.vendorCaseNo)).toContain("VC-E2E-B");
  });

  it("collector heartbeats are kept as the last ping, not as audit events", async () => {
    const noc = await t.tokenFor(fx.users.serviceDesk.email);
    for (let i = 0; i < 3; i++) {
      await t
        .http()
        .post("/api/v1/monitoring/collector-heartbeat")
        .set("authorization", `Bearer ${noc}`)
        .send({ siteCode: fx.site.code })
        .expect(200);
    }
    const audits = await t.prisma.auditEvent.count({ where: { action: "COLLECTOR_HEARTBEAT" } });
    expect(audits).toBe(0);
    const rows = await t.prisma.collectorHeartbeat.findMany();
    expect(rows).toEqual([expect.objectContaining({ siteCode: fx.site.code })]);

    const list = await t
      .http()
      .get("/api/v1/monitoring/collector-heartbeats")
      .set("authorization", `Bearer ${noc}`)
      .expect(200);
    expect(list.body.map((h: { siteCode: string }) => h.siteCode)).toEqual([fx.site.code]);
  });
});
