import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/** Knowledge article lifecycle over HTTP (spec §10.14). */
describe("Knowledge API (e2e)", () => {
  let t: TestApp;
  let fx: Fixture;
  let token: string;

  beforeAll(async () => {
    t = await createTestApp();
    await resetSchema(t.prisma);
    fx = await seedFixture(t.prisma);
    token = await t.tokenFor(fx.users.superAdmin.email);
  });
  afterAll(async () => {
    await resetSchema(t.prisma);
    await t.close();
  });

  const bearer = () => ({ authorization: `Bearer ${token}` });
  const future = new Date(Date.now() + 365 * 86_400_000).toISOString();

  it("draft → approve → edit reverts to draft (version bump) → re-approve → unpublish", async () => {
    const created = await t
      .http()
      .post("/api/v1/knowledge")
      .set(bearer())
      .send({
        title: "Replace a hot-swap PSU (R750)",
        body: "## Steps\n1. Identify amber PSU\n2. Swap",
      })
      .expect(201);
    const id = created.body.id;
    expect(created.body.approvalState).toBe("DRAFT");
    expect(created.body.version).toBe(1);

    const approved = await t
      .http()
      .post(`/api/v1/knowledge/${id}/approve`)
      .set(bearer())
      .send({ approverId: fx.users.infraLead.id, reviewDueAt: future })
      .expect(201);
    expect(approved.body.approvalState).toBe("APPROVED");
    expect(approved.body.authoritative).toBe(true);

    // editing the body invalidates the approval
    const edited = await t
      .http()
      .patch(`/api/v1/knowledge/${id}`)
      .set(bearer())
      .send({
        body: "## Steps\n1. Identify amber PSU (LED)\n2. Release latch\n3. Swap within 2 min",
      })
      .expect(200);
    expect(edited.body.version).toBe(2);
    expect(edited.body.approvalState).toBe("DRAFT");
    expect(edited.body.authoritative).toBe(false);

    await t
      .http()
      .post(`/api/v1/knowledge/${id}/approve`)
      .set(bearer())
      .send({ approverId: fx.users.infraLead.id, reviewDueAt: future })
      .expect(201);

    const unpublished = await t
      .http()
      .post(`/api/v1/knowledge/${id}/unpublish`)
      .set(bearer())
      .send({ reason: "Torque spec in step 3 is wrong — pending SME review" })
      .expect(201);
    expect(unpublished.body.approvalState).toBe("DRAFT");
  });

  it("refuses approval by the article owner (separation of duties, 400)", async () => {
    const created = await t
      .http()
      .post("/api/v1/knowledge")
      .set(bearer())
      .send({ title: "Owned runbook", body: "body text here", ownerId: fx.users.infraLead.id })
      .expect(201);
    await t
      .http()
      .post(`/api/v1/knowledge/${created.body.id}/approve`)
      .set(bearer())
      .send({ approverId: fx.users.infraLead.id, reviewDueAt: future })
      .expect(400);
  });

  it("rejects a review date in the past (400)", async () => {
    const created = await t
      .http()
      .post("/api/v1/knowledge")
      .set(bearer())
      .send({ title: "Another runbook", body: "more body text" })
      .expect(201);
    await t
      .http()
      .post(`/api/v1/knowledge/${created.body.id}/approve`)
      .set(bearer())
      .send({ approverId: fx.users.superAdmin.id, reviewDueAt: "2000-01-01T00:00:00.000Z" })
      .expect(400);
  });

  it("stores site scope + CI/category links and filters the list by them (spec §10.14)", async () => {
    const scoped = await t
      .http()
      .post("/api/v1/knowledge")
      .set(bearer())
      .send({
        title: "PDU failover at E2E01",
        body: "Site-specific power runbook",
        siteId: fx.site.id,
        incidentCategory: "POWER",
        ciType: "PDU",
      })
      .expect(201);
    expect(scoped.body.siteId).toBe(fx.site.id);
    expect(scoped.body.incidentCategory).toBe("POWER");
    expect(scoped.body.ciType).toBe("PDU");

    const bySite = await t
      .http()
      .get(`/api/v1/knowledge?siteId=${fx.site.id}&ciType=PDU`)
      .set(bearer())
      .expect(200);
    expect(bySite.body.some((a: { id: string }) => a.id === scoped.body.id)).toBe(true);

    const otherType = await t
      .http()
      .get("/api/v1/knowledge?ciType=SWITCH")
      .set(bearer())
      .expect(200);
    expect(otherType.body.some((a: { id: string }) => a.id === scoped.body.id)).toBe(false);
  });

  it("rejects an unknown ciType (400)", async () => {
    await t
      .http()
      .post("/api/v1/knowledge")
      .set(bearer())
      .send({ title: "bad type", body: "body text here", ciType: "TOASTER" })
      .expect(400);
  });
});
