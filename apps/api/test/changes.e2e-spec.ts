import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/** Change workflow + maintenance-window feed over HTTP (spec §10.6, §10.10 rule 5). */
describe("Changes API (e2e)", () => {
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

  const raise = (windowStart: string, windowEnd: string, affectedCiIds: string[] = []) =>
    t.http().post("/api/v1/changes").set("authorization", `Bearer ${token}`).send({
      changeType: "NORMAL",
      reason: "Firmware upgrade on E2E server",
      implementationPlan: "Drain, flash, verify POST",
      validationPlan: "Confirm POST clean and iDRAC health OK before closing the window",
      rollbackPlan: "Reflash previous image from USB",
      risk: "Low - N+1 retained",
      windowStart,
      windowEnd,
      affectedCiIds,
    });

  it("raises, approves, and surfaces an in-window change on the active-maintenance feed", async () => {
    const now = Date.now();
    const start = new Date(now - 60_000).toISOString(); // window already open
    const end = new Date(now + 3_600_000).toISOString();

    const created = await raise(start, end, [fx.ci.id]).expect(201);
    const id = created.body.id;
    expect(created.body.approverId ?? null).toBeNull();
    expect(created.body.validationPlan).toContain("Confirm POST clean");

    // not yet on the feed — needs approval first
    const before = await t
      .http()
      .get(`/api/v1/changes/maintenance/active?ciId=${fx.ci.id}`)
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(before.body.some((c: { id: string }) => c.id === id)).toBe(false);

    await t
      .http()
      .post(`/api/v1/changes/${id}/approve`)
      .set("authorization", `Bearer ${token}`)
      .send({ approverId: fx.users.infraLead.id })
      .expect(201);

    const after = await t
      .http()
      .get(`/api/v1/changes/maintenance/active?ciId=${fx.ci.id}`)
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(after.body.some((c: { id: string }) => c.id === id)).toBe(true);
  });

  it("cannot approve the same change twice (409)", async () => {
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 90_000_000).toISOString();
    const created = await raise(start, end).expect(201);

    await t
      .http()
      .post(`/api/v1/changes/${created.body.id}/approve`)
      .set("authorization", `Bearer ${token}`)
      .send({ approverId: fx.users.infraLead.id })
      .expect(201);
    await t
      .http()
      .post(`/api/v1/changes/${created.body.id}/approve`)
      .set("authorization", `Bearer ${token}`)
      .send({ approverId: fx.users.infraLead.id })
      .expect(409);
  });
});
