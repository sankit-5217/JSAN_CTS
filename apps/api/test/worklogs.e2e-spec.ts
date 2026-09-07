import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/** Engineer worklogs + immutable corrections over HTTP (spec §10.7, §12). */
describe("Worklogs API (e2e)", () => {
  let t: TestApp;
  let fx: Fixture;
  let token: string;
  let incidentId: string;

  beforeAll(async () => {
    t = await createTestApp();
    await resetSchema(t.prisma);
    fx = await seedFixture(t.prisma);
    token = await t.tokenFor(fx.users.superAdmin.email);

    const incident = await t
      .http()
      .post("/api/v1/incidents")
      .set("authorization", `Bearer ${token}`)
      .send({
        siteId: fx.site.id,
        ciId: fx.ci.id,
        category: "HARDWARE_FAILURE",
        impact: "HIGH",
        urgency: "HIGH",
        priority: "P3",
        shortDescription: "E2E incident for worklog coverage",
      })
      .expect(201);
    incidentId = incident.body.id;
  });
  afterAll(async () => {
    await resetSchema(t.prisma);
    await t.close();
  });

  it("creates a worklog with a server-derived duration; durationMinutes is not client-settable", async () => {
    const created = await t
      .http()
      .post(`/api/v1/incidents/${incidentId}/worklogs`)
      .set("authorization", `Bearer ${token}`)
      .send({
        activityType: "REMOTE_WORK",
        startedAt: "2026-09-03T09:00:00Z",
        endedAt: "2026-09-03T10:30:00Z",
        notes: "Diagnosed PSU failure",
      })
      .expect(201);
    expect(created.body.durationMinutes).toBe(90);

    const list = await t
      .http()
      .get(`/api/v1/incidents/${incidentId}/worklogs`)
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(list.body.some((w: { id: string }) => w.id === created.body.id)).toBe(true);
  });

  it("a forbidden role cannot create a worklog (403)", async () => {
    const viewer = await t.tokenFor(fx.users.ctsViewer.email);
    await t
      .http()
      .post(`/api/v1/incidents/${incidentId}/worklogs`)
      .set("authorization", `Bearer ${viewer}`)
      .send({ activityType: "REMOTE_WORK", startedAt: "2026-09-03T09:00:00Z" })
      .expect(403);
  });

  it("requires editReason to correct a worklog (400 without it, 200 with it)", async () => {
    const created = await t
      .http()
      .post(`/api/v1/incidents/${incidentId}/worklogs`)
      .set("authorization", `Bearer ${token}`)
      .send({ activityType: "TESTING", startedAt: "2026-09-03T11:00:00Z" })
      .expect(201);

    await t
      .http()
      .patch(`/api/v1/worklogs/${created.body.id}`)
      .set("authorization", `Bearer ${token}`)
      .send({ notes: "Corrected note, no reason given" })
      .expect(400);

    const corrected = await t
      .http()
      .patch(`/api/v1/worklogs/${created.body.id}`)
      .set("authorization", `Bearer ${token}`)
      .send({ notes: "Corrected note", editReason: "Fixed a typo in the original note" })
      .expect(200);
    expect(corrected.body.notes).toBe("Corrected note");
  });
});
