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

  it("GET /transitions reflects the caller's actual role-eligible next moves, not a fixed list", async () => {
    const noc = await t.tokenFor(fx.users.serviceDesk.email);
    const viewer = await t.tokenFor(fx.users.ctsViewer.email);
    // Customer-reported, not staff-created — so `viewer`'s own transitions
    // check below is against a ticket they're actually allowed to see
    // (reportedByUserId scoping, see the reporter-scoping test at the
    // bottom of this file), not an unrelated incident at their site.
    const created = await t
      .http()
      .post("/api/v1/incidents/customer-report")
      .set("authorization", `Bearer ${viewer}`)
      .send({
        siteId: fx.site.id,
        category: "HARDWARE_FAILURE",
        shortDescription: "E2E server unresponsive after power event",
      })
      .expect(201); // NEW

    // NEW -> ASSIGNED is SERVICE_DESK_NOC's to make, no owner gate on this
    // rule — but it does have a custom validate() requiring an owner to be
    // resolved, surfaced here as `hint` since it's neither a requiredFields
    // entry nor a role/ownership block.
    const nocView = await t
      .http()
      .get(`/api/v1/incidents/${created.body.id}/transitions`)
      .set("authorization", `Bearer ${noc}`)
      .expect(200);
    expect(nocView.body).toEqual([
      {
        toStatus: "ASSIGNED",
        requiredFields: [],
        allowed: true,
        hint: expect.stringContaining("resolved"),
      },
    ]);

    // CTS_MANAGER_VIEWER is never in any incident transition's allowedRoles
    // — but they can still see their own ticket's (empty) transition list.
    const viewerView = await t
      .http()
      .get(`/api/v1/incidents/${created.body.id}/transitions`)
      .set("authorization", `Bearer ${viewer}`)
      .expect(200);
    expect(viewerView.body).toEqual([]);

    // move it to IN_PROGRESS, then check requiredFields surfaces for
    // IN_PROGRESS -> PENDING_CUSTOMER (needs "reason")
    await t
      .http()
      .post(`/api/v1/incidents/${created.body.id}/transition`)
      .set("authorization", `Bearer ${noc}`)
      .send({ toStatus: "ASSIGNED", ownerUserId: fx.users.serviceDesk.id })
      .expect(201);
    // fx.siteEngineer isn't scoped to fx.site (see the file-level comment on
    // Fixture), so use an elevated role to walk it forward instead.
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    await t
      .http()
      .post(`/api/v1/incidents/${created.body.id}/transition`)
      .set("authorization", `Bearer ${admin}`)
      .send({ toStatus: "ACKNOWLEDGED" })
      .expect(201);
    await t
      .http()
      .post(`/api/v1/incidents/${created.body.id}/transition`)
      .set("authorization", `Bearer ${admin}`)
      .send({ toStatus: "IN_PROGRESS" })
      .expect(201);

    const afterInProgress = await t
      .http()
      .get(`/api/v1/incidents/${created.body.id}/transitions`)
      .set("authorization", `Bearer ${noc}`)
      .expect(200);
    expect(afterInProgress.body).toEqual([
      { toStatus: "PENDING_CUSTOMER", requiredFields: ["reason"], allowed: true },
    ]);
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

  it("a customer self-reports an issue, it lands as P3/MEDIUM/MEDIUM pending triage, and Service Desk can see + reply on it", async () => {
    const viewer = await t.tokenFor(fx.users.ctsViewer.email);
    const noc = await t.tokenFor(fx.users.serviceDesk.email);

    // rejected: a site the customer has no access to
    await t
      .http()
      .post("/api/v1/incidents/customer-report")
      .set("authorization", `Bearer ${viewer}`)
      .send({
        siteId: fx.siteB.id,
        category: "HARDWARE_FAILURE",
        shortDescription: "Should be rejected",
      })
      .expect(403);

    const created = await t
      .http()
      .post("/api/v1/incidents/customer-report")
      .set("authorization", `Bearer ${viewer}`)
      .send({
        siteId: fx.site.id,
        category: "HARDWARE_FAILURE",
        shortDescription: "Server in Rack 3 showing a red fault light",
        details: "Started around 2pm, other equipment in the rack seems fine.",
      })
      .expect(201);
    expect(created.body).toMatchObject({
      status: "NEW",
      priority: "P3",
      impact: "MEDIUM",
      urgency: "MEDIUM",
    });

    // an internal role in INCIDENT_WRITE_ROLES, not the customer role, must
    // still gate the plain create route (customer-report is additive, not
    // a bypass)
    await t
      .http()
      .post("/api/v1/incidents")
      .set("authorization", `Bearer ${viewer}`)
      .send({
        siteId: fx.site.id,
        category: "HARDWARE_FAILURE",
        impact: "HIGH",
        urgency: "HIGH",
        priority: "P1",
        shortDescription: "Should be rejected on the internal-only route",
      })
      .expect(403);

    // the "details" text landed as a customer-visible comment
    const comments = await t
      .http()
      .get(`/api/v1/incidents/${created.body.id}/comments`)
      .set("authorization", `Bearer ${viewer}`)
      .expect(200);
    expect(comments.body).toHaveLength(1);
    expect(comments.body[0]).toMatchObject({
      isInternal: false,
      body: expect.stringContaining("2pm"),
    });

    // Service Desk sees it and replies; the reply defaults to internal=true
    // unless marked otherwise, but the customer's own comment write always
    // forces isInternal=false regardless of what's sent
    await t
      .http()
      .post(`/api/v1/incidents/${created.body.id}/comments`)
      .set("authorization", `Bearer ${noc}`)
      .send({ body: "Can you confirm the server's asset tag?", isInternal: false })
      .expect(201);

    const attemptInternal = await t
      .http()
      .post(`/api/v1/incidents/${created.body.id}/comments`)
      .set("authorization", `Bearer ${viewer}`)
      .send({ body: "It's on the front panel.", isInternal: true })
      .expect(201);
    expect(attemptInternal.body.isInternal).toBe(false);

    const finalComments = await t
      .http()
      .get(`/api/v1/incidents/${created.body.id}/comments`)
      .set("authorization", `Bearer ${viewer}`)
      .expect(200);
    expect(finalComments.body).toHaveLength(3);
  });

  it("a customer only sees their own reported tickets, never another incident at the same site", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    const viewer = await t.tokenFor(fx.users.ctsViewer.email);

    // Staff-created — reportedByUserId is null, not the customer's.
    const staffIncident = await createIncident(admin, fx.site.id).expect(201);

    // Customer-reported — reportedByUserId is the customer's own id.
    const ownIncident = await t
      .http()
      .post("/api/v1/incidents/customer-report")
      .set("authorization", `Bearer ${viewer}`)
      .send({
        siteId: fx.site.id,
        category: "HARDWARE_FAILURE",
        shortDescription: "My own ticket",
      })
      .expect(201);

    // The list only contains what this customer actually reported.
    const list = await t
      .http()
      .get("/api/v1/incidents")
      .set("authorization", `Bearer ${viewer}`)
      .expect(200);
    const ids = list.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(ownIncident.body.id);
    expect(ids).not.toContain(staffIncident.body.id);

    // Same-site access alone isn't enough to read another incident's detail.
    await t
      .http()
      .get(`/api/v1/incidents/${staffIncident.body.id}`)
      .set("authorization", `Bearer ${viewer}`)
      .expect(403);

    // But their own is readable.
    await t
      .http()
      .get(`/api/v1/incidents/${ownIncident.body.id}`)
      .set("authorization", `Bearer ${viewer}`)
      .expect(200);
  });
});
