import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/** SLA policy CRUD + config-over-hardcode over HTTP (spec §10.8, §12, CLAUDE.md). */
describe("SLA API (e2e)", () => {
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

  it("an allowed role creates a policy; a disallowed role is forbidden (403)", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email); // in SLA_POLICY_WRITE_ROLES
    const created = await t
      .http()
      .post("/api/v1/sla/policies")
      .set("authorization", `Bearer ${admin}`)
      .send({
        name: "P1 - Critical (24x7)",
        priority: "P1",
        ackTargetMinutes: 15,
        resolveTargetMinutes: 240,
        effectiveFrom: "2026-01-01T00:00:00Z",
      })
      .expect(201);
    expect(created.body.priority).toBe("P1");

    const engineer = await t.tokenFor(fx.users.siteEngineer.email); // not in SLA_POLICY_WRITE_ROLES
    await t
      .http()
      .post("/api/v1/sla/policies")
      .set("authorization", `Bearer ${engineer}`)
      .send({
        name: "Forbidden policy",
        priority: "P2",
        ackTargetMinutes: 15,
        resolveTargetMinutes: 240,
        effectiveFrom: "2026-01-01T00:00:00Z",
      })
      .expect(403);
  });

  it("filters policies by priority", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    const res = await t
      .http()
      .get("/api/v1/sla/policies?priority=P3")
      .set("authorization", `Bearer ${admin}`)
      .expect(200);
    expect(res.body.every((p: { priority: string }) => p.priority === "P3")).toBe(true);
    expect(res.body.some((p: { id: string }) => p.id === fx.slaPolicy.id)).toBe(true);
  });

  it("updates an existing policy", async () => {
    const admin = await t.tokenFor(fx.users.superAdmin.email);
    const updated = await t
      .http()
      .patch(`/api/v1/sla/policies/${fx.slaPolicy.id}`)
      .set("authorization", `Bearer ${admin}`)
      .send({ ackTargetMinutes: 45 })
      .expect(200);
    expect(updated.body.ackTargetMinutes).toBe(45);
  });
});
