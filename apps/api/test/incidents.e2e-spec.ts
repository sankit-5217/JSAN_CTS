import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/** Incident state machine + site scope over HTTP (spec §10.3, §12). */
describe("Incidents API (e2e)", () => {
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

  const createIncident = (token: string, siteId: string) =>
    t
      .http()
      .post("/api/v1/incidents")
      .set("authorization", `Bearer ${token}`)
      .send({
        siteId,
        ciId: siteId === fx.site.id ? fx.ci.id : undefined,
        category: "HARDWARE_FAILURE",
        impact: "HIGH",
        urgency: "HIGH",
        priority: "P3",
        shortDescription: "E2E server unresponsive after power event",
      });

  it("an allowed role creates an incident (NEW, SLA instance attached); a disallowed role is forbidden (403)", async () => {
    const noc = await t.tokenFor(fx.users.serviceDesk.email); // in INCIDENT_WRITE_ROLES
    const created = await createIncident(noc, fx.site.id).expect(201);
    expect(created.body.status).toBe("NEW");

    const sla = await t
      .http()
      .get(`/api/v1/incidents/${created.body.id}/sla`)
      .set("authorization", `Bearer ${noc}`)
      .expect(200);
    expect(sla.body.slaPolicyId).toBe(fx.slaPolicy.id);

    const viewer = await t.tokenFor(fx.users.ctsViewer.email); // not in INCIDENT_WRITE_ROLES
    await createIncident(viewer, fx.site.id).expect(403);
  });

  it("walks NEW -> ASSIGNED -> ACKNOWLEDGED through the transition state machine", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    const created = await createIncident(admin, fx.site.id).expect(201);
    const id = created.body.id;

    // NEW -> ASSIGNED requires an owner to be resolved
    await t
      .http()
      .post(`/api/v1/incidents/${id}/transition`)
      .set("authorization", `Bearer ${admin}`)
      .send({ toStatus: "ASSIGNED", ownerUserId: fx.users.superAdmin.id })
      .expect(201);

    // ASSIGNED -> ACKNOWLEDGED requires the owner or an elevated role (SUPER_ADMIN qualifies)
    const acked = await t
      .http()
      .post(`/api/v1/incidents/${id}/transition`)
      .set("authorization", `Bearer ${admin}`)
      .send({ toStatus: "ACKNOWLEDGED" })
      .expect(201);
    expect(acked.body.status).toBe("ACKNOWLEDGED");

    // an invalid jump (ACKNOWLEDGED -> CLOSED, skipping IN_PROGRESS/RESOLVED) is rejected
    await t
      .http()
      .post(`/api/v1/incidents/${id}/transition`)
      .set("authorization", `Bearer ${admin}`)
      .send({ toStatus: "CLOSED" })
      .expect(400);
  });

  it("creates and lists comments on an incident", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    const created = await createIncident(admin, fx.site.id).expect(201);

    await t
      .http()
      .post(`/api/v1/incidents/${created.body.id}/comments`)
      .set("authorization", `Bearer ${admin}`)
      .send({ body: "Escalated to vendor for RMA." })
      .expect(201);

    const comments = await t
      .http()
      .get(`/api/v1/incidents/${created.body.id}/comments`)
      .set("authorization", `Bearer ${admin}`)
      .expect(200);
    expect(comments.body.some((c: { body: string }) => c.body.includes("Escalated"))).toBe(true);
  });

  it("a scoped viewer cannot read an incident on a site they don't have access to (403)", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    const created = await createIncident(admin, fx.siteB.id).expect(201);

    const viewer = await t.tokenFor(fx.users.ctsViewer.email); // granted only `site`, not `siteB`
    await t
      .http()
      .get(`/api/v1/incidents/${created.body.id}`)
      .set("authorization", `Bearer ${viewer}`)
      .expect(403);
  });
});
