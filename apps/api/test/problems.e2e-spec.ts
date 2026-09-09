import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/** Problem / RCA workflow over HTTP (spec §10.5). */
describe("Problems API (e2e)", () => {
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

  it("walks a problem through investigation to resolution with the root-cause gate", async () => {
    const created = await t
      .http()
      .post("/api/v1/problems")
      .set(bearer())
      .send({
        title: "Recurring PSU trips",
        symptoms: "PSU alarms across the rack",
        priority: "P2",
      })
      .expect(201);
    const id = created.body.id;
    expect(created.body.status).toBe("OPEN");

    // action item add + complete
    const item = await t
      .http()
      .post(`/api/v1/problems/${id}/action-items`)
      .set(bearer())
      .send({ description: "Audit PDU load balance" })
      .expect(201);
    await t
      .http()
      .patch(`/api/v1/problems/${id}/action-items/${item.body.id}`)
      .set(bearer())
      .expect(200);

    // link a change, then unlink it
    const change = await t
      .http()
      .post("/api/v1/changes")
      .set(bearer())
      .send({
        changeType: "NORMAL",
        reason: "Rebalance PDU circuits",
        implementationPlan: "Move loads to circuit B",
        validationPlan: "Confirm PDU load draw balanced within 10% across circuits",
        rollbackPlan: "Move back",
        risk: "Low",
        windowStart: new Date(Date.now() + 86_400_000).toISOString(),
        windowEnd: new Date(Date.now() + 90_000_000).toISOString(),
      })
      .expect(201);
    const link = await t
      .http()
      .post(`/api/v1/problems/${id}/links`)
      .set(bearer())
      .send({ entityType: "CHANGE", entityId: change.body.id })
      .expect(201);
    // duplicate link → 409
    await t
      .http()
      .post(`/api/v1/problems/${id}/links`)
      .set(bearer())
      .send({ entityType: "CHANGE", entityId: change.body.id })
      .expect(409);

    await t
      .http()
      .post(`/api/v1/problems/${id}/transition`)
      .set(bearer())
      .send({ toStatus: "INVESTIGATING" })
      .expect(201);

    // RESOLVED requires a root cause first
    await t
      .http()
      .post(`/api/v1/problems/${id}/transition`)
      .set(bearer())
      .send({ toStatus: "RESOLVED" })
      .expect(400);

    await t
      .http()
      .patch(`/api/v1/problems/${id}`)
      .set(bearer())
      .send({ rootCause: "Undersized PDU circuit; sustained >80% load tripped the PSUs" })
      .expect(200);

    const resolved = await t
      .http()
      .post(`/api/v1/problems/${id}/transition`)
      .set(bearer())
      .send({ toStatus: "RESOLVED" })
      .expect(201);
    expect(resolved.body.status).toBe("RESOLVED");
    expect(resolved.body.resolvedAt).toBeTruthy();

    await t.http().delete(`/api/v1/problems/${id}/links/${link.body.id}`).set(bearer()).expect(204);

    const finalState = await t.http().get(`/api/v1/problems/${id}`).set(bearer()).expect(200);
    expect(finalState.body.links).toHaveLength(0);
    expect(finalState.body.actionItems[0].completedAt).toBeTruthy();
  });

  it("rejects an illegal transition even when required fields are set (OPEN → RESOLVED)", async () => {
    const created = await t
      .http()
      .post("/api/v1/problems")
      .set(bearer())
      .send({ title: "Illegal jump", symptoms: "symptom text" })
      .expect(201);
    // root cause is set, so this 400 is the transition matrix (OPEN has no path
    // to RESOLVED), not the field gate
    await t
      .http()
      .patch(`/api/v1/problems/${created.body.id}`)
      .set(bearer())
      .send({ rootCause: "known cause" })
      .expect(200);
    await t
      .http()
      .post(`/api/v1/problems/${created.body.id}/transition`)
      .set(bearer())
      .send({ toStatus: "RESOLVED" })
      .expect(400);
  });
});
