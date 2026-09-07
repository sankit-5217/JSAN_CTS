import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/** CMDB (CIs) over HTTP: RBAC, pagination, and managementAddress redaction (spec §9.1, §12). */
describe("CMDB API (e2e)", () => {
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

  it("an allowed role creates a CI; a disallowed role is forbidden (403)", async () => {
    const infra = await t.tokenFor(fx.users.infraLead.email); // in CMDB_WRITE_ROLES
    const created = await t
      .http()
      .post("/api/v1/cis")
      .set("authorization", `Bearer ${infra}`)
      .send({
        ciCode: "E2E01-R01-SRV-002",
        siteId: fx.site.id,
        rackId: fx.rack.id,
        ciType: "SERVER",
        name: "E2E Server 002",
        managedBy: "JSAN",
        criticality: "HIGH",
        managementAddress: "10.0.0.2",
      })
      .expect(201);
    expect(created.body.managementAddress).toBe("10.0.0.2");

    const noc = await t.tokenFor(fx.users.serviceDesk.email); // not in CMDB_WRITE_ROLES
    await t
      .http()
      .post("/api/v1/cis")
      .set("authorization", `Bearer ${noc}`)
      .send({
        ciCode: "E2E01-R01-SRV-003",
        siteId: fx.site.id,
        ciType: "SERVER",
        name: "Forbidden",
        managedBy: "JSAN",
        criticality: "LOW",
      })
      .expect(403);
  });

  it("paginates the CI list", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    const res = await t
      .http()
      .get("/api/v1/cis?limit=1&offset=0")
      .set("authorization", `Bearer ${admin}`)
      .expect(200);
    expect(res.body).toMatchObject({ limit: 1, offset: 0 });
    expect(res.body.items.length).toBe(1);
  });

  it("redacts managementAddress from list and detail responses for CTS_MANAGER_VIEWER, but not other roles", async () => {
    const viewer = await t.tokenFor(fx.users.ctsViewer.email);
    const admin = await t.tokenFor(fx.users.superAdmin.email);

    const viewerDetail = await t
      .http()
      .get(`/api/v1/cis/${fx.ci.id}`)
      .set("authorization", `Bearer ${viewer}`)
      .expect(200);
    expect(viewerDetail.body.managementAddress).toBeUndefined();
    expect(viewerDetail.body.ciCode).toBe(fx.ci.ciCode); // rest of the object is intact

    const adminDetail = await t
      .http()
      .get(`/api/v1/cis/${fx.ci.id}`)
      .set("authorization", `Bearer ${admin}`)
      .expect(200);
    expect(adminDetail.body.managementAddress).toBe("10.0.0.1");

    const viewerList = await t
      .http()
      .get("/api/v1/cis")
      .set("authorization", `Bearer ${viewer}`)
      .expect(200);
    expect(
      viewerList.body.items.every(
        (ci: { managementAddress?: string }) => ci.managementAddress === undefined,
      ),
    ).toBe(true);
  });

  it("a scoped role cannot fetch a CI outside its site access (403)", async () => {
    const viewer = await t.tokenFor(fx.users.ctsViewer.email); // granted only `site`
    const admin = await t.tokenFor(fx.users.superAdmin.email);

    const restrictedCi = await t
      .http()
      .post("/api/v1/cis")
      .set("authorization", `Bearer ${admin}`)
      .send({
        ciCode: "E2E02-SRV-001",
        siteId: fx.siteB.id,
        ciType: "SERVER",
        name: "Restricted-site server",
        managedBy: "JSAN",
        criticality: "LOW",
      })
      .expect(201);

    await t
      .http()
      .get(`/api/v1/cis/${restrictedCi.body.id}`)
      .set("authorization", `Bearer ${viewer}`)
      .expect(403);
  });
});
