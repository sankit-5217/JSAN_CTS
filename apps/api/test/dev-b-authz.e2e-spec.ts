import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/**
 * End-to-end coverage of the Dev B request path over a real HTTP socket and a
 * real database: the guards actually reject, `dev-login` mints a usable token,
 * the global ValidationPipe rejects at the edge, and a couple of module happy
 * paths (problem numbering, idempotent alert ingest) work through the stack.
 */
describe("Dev B API (e2e)", () => {
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

  describe("authentication", () => {
    it("rejects a write with no bearer token (401)", async () => {
      await t.http().post("/api/v1/problems").send({ title: "x", symptoms: "y" }).expect(401);
    });

    it("dev-login issues a token for a seeded user", async () => {
      const res = await t
        .http()
        .post("/api/v1/auth/dev-login")
        .send({ email: fx.users.superAdmin.email })
        .expect(201);
      expect(typeof res.body.accessToken).toBe("string");
    });

    it("rejects dev-login for an unknown user (401)", async () => {
      await t
        .http()
        .post("/api/v1/auth/dev-login")
        .send({ email: "nobody@example.com" })
        .expect(401);
    });
  });

  describe("authorization", () => {
    it("forbids a write to a caller without the required role (403)", async () => {
      const noc = await t.tokenFor(fx.users.serviceDesk.email); // SERVICE_DESK_NOC
      await t
        .http()
        .post("/api/v1/alert-rules")
        .set("authorization", `Bearer ${noc}`)
        .send({ name: "nope" })
        .expect(403);
    });

    it("allows the same write for a caller with the role (201)", async () => {
      const infra = await t.tokenFor(fx.users.infraLead.email); // INFRASTRUCTURE_LEAD
      const res = await t
        .http()
        .post("/api/v1/alert-rules")
        .set("authorization", `Bearer ${infra}`)
        .send({ name: "e2e-rule", siteId: fx.site.id, pagingSeverities: ["CRITICAL"] })
        .expect(201);
      expect(res.body).toMatchObject({ name: "e2e-rule" });
    });

    it("lets any authenticated user read (GET /problems as a site engineer)", async () => {
      const eng = await t.tokenFor(fx.users.siteEngineer.email);
      const res = await t
        .http()
        .get("/api/v1/problems")
        .set("authorization", `Bearer ${eng}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("validation at the edge", () => {
    it("rejects an unknown field (forbidNonWhitelisted, 400)", async () => {
      const infra = await t.tokenFor(fx.users.infraLead.email);
      await t
        .http()
        .post("/api/v1/alert-rules")
        .set("authorization", `Bearer ${infra}`)
        .send({ name: "bad", bogusField: 1 })
        .expect(400);
    });

    it("enforces the Alertmanager batch cap end-to-end (400 over 500)", async () => {
      const noc = await t.tokenFor(fx.users.serviceDesk.email); // in ALERT_INGEST_ROLES
      const alert = {
        status: "firing",
        labels: {},
        annotations: {},
        startsAt: "2026-09-07T00:00:00.000Z",
        endsAt: "0001-01-01T00:00:00Z",
        fingerprint: "f",
      };
      await t
        .http()
        .post("/api/v1/alerts/sources/alertmanager")
        .set("authorization", `Bearer ${noc}`)
        .send({ version: "4", status: "firing", alerts: Array.from({ length: 501 }, () => alert) })
        .expect(400);
    });
  });

  describe("module happy paths", () => {
    it("numbers a new problem PRB-000001", async () => {
      const admin = await t.tokenFor(fx.users.superAdmin.email);
      const res = await t
        .http()
        .post("/api/v1/problems")
        .set("authorization", `Bearer ${admin}`)
        .send({
          title: "Recurring PSU trips",
          symptoms: "PSU alarms across the rack",
          priority: "P2",
        })
        .expect(201);
      expect(res.body.problemNo).toBe("PRB-000001");
      expect(res.body.status).toBe("OPEN");
    });

    it("ingests an alert and dedupes a replay of the same event id", async () => {
      const noc = await t.tokenFor(fx.users.serviceDesk.email);
      const body = {
        source: "REDFISH",
        eventId: "e2e-evt-1",
        siteCode: fx.site.code,
        ciCode: fx.ci.ciCode,
        alertType: "hardware.psu_failure",
        severity: "CRITICAL",
        state: "OPEN",
        summary: "PSU 1 failed",
        occurredAt: "2026-09-07T08:00:00.000Z",
      };
      const first = await t
        .http()
        .post("/api/v1/alerts/ingest")
        .set("authorization", `Bearer ${noc}`)
        .send(body)
        .expect(200);
      expect(first.body.deduped).toBe(false);

      const replay = await t
        .http()
        .post("/api/v1/alerts/ingest")
        .set("authorization", `Bearer ${noc}`)
        .send(body)
        .expect(200);
      expect(replay.body.deduped).toBe(true);
      expect(replay.body.alertId).toBe(first.body.alertId);
    });
  });
});
