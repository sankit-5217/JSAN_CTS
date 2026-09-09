import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/** Risk register + BCP plan readiness over HTTP (spec §10.15). */
describe("Risks + BCP API (e2e)", () => {
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

  it("derives score / severity and moves status only through the transition endpoint", async () => {
    const created = await t
      .http()
      .post("/api/v1/risks")
      .set(bearer())
      .send({
        description: "Single PDU circuit per rack - no A/B feed",
        likelihood: 3,
        impact: 4,
        evidence: "Power distribution audit 2026-08, section 4.2",
      })
      .expect(201);
    expect(created.body.score).toBe(12);
    expect(created.body.severity).toBe("HIGH");
    expect(created.body.status).toBe("OPEN");
    expect(created.body.evidence).toBe("Power distribution audit 2026-08, section 4.2");

    // PATCH cannot set status
    await t
      .http()
      .patch(`/api/v1/risks/${created.body.id}`)
      .set(bearer())
      .send({ status: "CLOSED" })
      .expect(400);

    const moved = await t
      .http()
      .post(`/api/v1/risks/${created.body.id}/status`)
      .set(bearer())
      .send({ status: "MITIGATING", mitigation: "Procure a second PDU + static transfer switch" })
      .expect(201);
    expect(moved.body.status).toBe("MITIGATING");
  });

  it("BCP plan covers a site XOR a service, and a logged test flips readiness to READY", async () => {
    // both scopes → rejected
    await t
      .http()
      .post("/api/v1/bcp-plans")
      .set(bearer())
      .send({
        name: "bad scope",
        siteId: fx.site.id,
        serviceName: "billing",
        recoveryStrategy: "x".repeat(10),
        rtoMinutes: 30,
        rpoMinutes: 0,
      })
      .expect(400);

    const created = await t
      .http()
      .post("/api/v1/bcp-plans")
      .set(bearer())
      .send({
        name: "E2E01 power continuity",
        siteId: fx.site.id,
        recoveryStrategy: "Shift rack loads to the B feed; generator within 10 minutes",
        rtoMinutes: 30,
        rpoMinutes: 0,
      })
      .expect(201);
    expect(created.body.readiness).toBe("UNTESTED");

    const tested = await t
      .http()
      .post(`/api/v1/bcp-plans/${created.body.id}/tests`)
      .set(bearer())
      .send({
        notes: "Tabletop drill, all steps walked",
        nextTestDueAt: new Date(Date.now() + 180 * 86_400_000).toISOString(),
      })
      .expect(201);
    expect(tested.body.readiness).toBe("READY");
    expect(tested.body.lastTestedAt).toBeTruthy();
  });
});
