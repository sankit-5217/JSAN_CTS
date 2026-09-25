import { createTestApp, TestApp } from "./app";
import { E2E_PASSWORD, Fixture, resetSchema, seedFixture } from "./fixture";

/**
 * User administration over HTTP: Super-Admin-only access, provisioning,
 * site grants, and the cross-module vetoes (open incidents block
 * deactivation; skills/active shifts block an engineer's move off an
 * engineer role) answered by the real incidents/skills/shifts listeners.
 */
describe("User admin API (e2e)", () => {
  let t: TestApp;
  let fx: Fixture;
  let admin: string;

  beforeAll(async () => {
    t = await createTestApp();
    await resetSchema(t.prisma);
    fx = await seedFixture(t.prisma);
    admin = await t.tokenFor(fx.users.superAdmin.email);
  });
  afterAll(async () => {
    await resetSchema(t.prisma);
    await t.close();
  });

  const as = (token: string) => ({
    get: (path: string) => t.http().get(path).set("authorization", `Bearer ${token}`),
    post: (path: string, body?: object) =>
      t.http().post(path).set("authorization", `Bearer ${token}`).send(body),
    patch: (path: string, body: object) =>
      t.http().patch(path).set("authorization", `Bearer ${token}`).send(body),
    put: (path: string, body: object) =>
      t.http().put(path).set("authorization", `Bearer ${token}`).send(body),
  });

  it("is Super Admin only (403 for every other role, including managers)", async () => {
    for (const email of [
      fx.users.serviceDesk.email,
      fx.users.auditor.email,
      fx.users.infraLead.email,
    ]) {
      await as(await t.tokenFor(email))
        .get("/api/v1/admin/users")
        .expect(403);
    }
    await t.http().get("/api/v1/admin/users").expect(401);
  });

  /** Completes a created user's invite with the shared test password. */
  const acceptInvite = async (created: { invite: { link: string } }) => {
    const token = created.invite.link.split("#token=")[1];
    await t
      .http()
      .post("/api/v1/auth/password/set")
      .send({ token, password: E2E_PASSWORD })
      .expect(200);
  };

  it("adds a user with an invite they can accept, and audits it; duplicate email is 409", async () => {
    const created = await as(admin)
      .post("/api/v1/admin/users", {
        email: "  New.Person@Example.com ",
        displayName: " New Person ",
        role: "SITE_ENGINEER",
        siteIds: [fx.site.id],
      })
      .expect(201);
    expect(created.body).toMatchObject({
      email: "new.person@example.com",
      displayName: "New Person",
      isActive: true,
      hasPassword: false,
      socialProviders: [],
      allSites: false,
      siteIds: [fx.site.id],
    });
    expect(created.body.invite).toMatchObject({ purpose: "INVITE" });

    await acceptInvite(created.body);
    await t.tokenFor("new.person@example.com"); // throws unless login works

    await as(admin)
      .post("/api/v1/admin/users", {
        email: "NEW.person@example.com",
        displayName: "Dup",
        role: "SITE_ENGINEER",
      })
      .expect(409);
    await as(admin)
      .post("/api/v1/admin/users", {
        email: "x@example.com",
        displayName: "X",
        role: "SITE_ENGINEER",
        siteIds: ["00000000-0000-4000-8000-000000000000"],
      })
      .expect(400);

    const audit = await t.prisma.auditEvent.findFirst({
      where: { entityId: created.body.id, action: "USER_CREATED" },
    });
    expect(audit?.actorId).toBe(fx.users.superAdmin.id);
  });

  it("replaces site grants, which immediately change what the user can see", async () => {
    const created = await as(admin)
      .post("/api/v1/admin/users", {
        email: "scoped@example.com",
        displayName: "Scoped",
        role: "SERVICE_DESK_NOC",
        siteIds: [fx.site.id],
      })
      .expect(201);
    await acceptInvite(created.body);
    const token = await t.tokenFor("scoped@example.com");
    await as(token).get(`/api/v1/sites/${fx.siteB.id}`).expect(403);

    const updated = await as(admin)
      .put(`/api/v1/admin/users/${created.body.id}/sites`, { siteIds: [fx.siteB.id] })
      .expect(200);
    expect(updated.body.siteIds).toEqual([fx.siteB.id]);
    await as(token).get(`/api/v1/sites/${fx.siteB.id}`).expect(200);
    await as(token).get(`/api/v1/sites/${fx.site.id}`).expect(403);
  });

  it("refuses to deactivate someone who owns open incidents, then allows it once reassigned", async () => {
    const incident = await as(admin)
      .post("/api/v1/incidents", {
        siteId: fx.site.id,
        ciId: fx.ci.id,
        category: "HARDWARE_FAILURE",
        impact: "HIGH",
        urgency: "HIGH",
        priority: "P3",
        shortDescription: "E2E owned by the engineer",
      })
      .expect(201);
    await as(admin)
      .post(`/api/v1/incidents/${incident.body.id}/transition`, {
        toStatus: "ASSIGNED",
        ownerUserId: fx.users.siteEngineer.id,
      })
      .expect(201);
    const engineerToken = await t.tokenFor(fx.users.siteEngineer.email);

    const refused = await as(admin)
      .post(`/api/v1/admin/users/${fx.users.siteEngineer.id}/deactivate`)
      .expect(409);
    expect(refused.body.blockers).toEqual([
      expect.objectContaining({ source: "incidents", examples: [incident.body.incidentNo] }),
    ]);

    await t.prisma.incident.update({
      where: { id: incident.body.id },
      data: { ownerUserId: fx.users.infraLead.id },
    });
    const done = await as(admin)
      .post(`/api/v1/admin/users/${fx.users.siteEngineer.id}/deactivate`)
      .expect(200);
    expect(done.body.isActive).toBe(false);

    // their existing session stops working at once
    await as(engineerToken).get("/api/v1/sites").expect(401);

    await as(admin).post(`/api/v1/admin/users/${fx.users.siteEngineer.id}/reactivate`).expect(200);
    await as(engineerToken).get("/api/v1/sites").expect(200);
  });

  it("refuses an engineer's move to a non-engineer role while they hold skills or active shifts", async () => {
    const lead = fx.users.infraLead;
    const skill = await t.prisma.skill.create({ data: { name: "E2E Dell PowerEdge" } });
    await t.prisma.userSkill.create({ data: { userId: lead.id, skillId: skill.id } });
    const shift = await t.prisma.engineerShift.create({
      data: {
        userId: lead.id,
        siteId: fx.site.id,
        label: "E2E Day",
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "17:00",
      },
    });

    const refused = await as(admin)
      .patch(`/api/v1/admin/users/${lead.id}`, { role: "SERVICE_DESK_NOC" })
      .expect(409);
    expect(refused.body.blockers.map((b: { source: string }) => b.source).sort()).toEqual([
      "shifts",
      "skills",
    ]);

    // engineer -> engineer is fine even with skills/shifts
    await as(admin).patch(`/api/v1/admin/users/${lead.id}`, { role: "SITE_ENGINEER" }).expect(200);

    await t.prisma.userSkill.deleteMany({ where: { userId: lead.id } });
    await as(admin).patch(`/api/v1/shifts/${shift.id}`, { isActive: false }).expect(200);
    const moved = await as(admin)
      .patch(`/api/v1/admin/users/${lead.id}`, { role: "SERVICE_DESK_NOC" })
      .expect(200);
    expect(moved.body.role).toBe("SERVICE_DESK_NOC");

    // and the disabled shift can't be switched back on for a non-engineer
    await as(admin).patch(`/api/v1/shifts/${shift.id}`, { isActive: true }).expect(400);
  });

  it("won't let an admin change their own role or deactivate themselves", async () => {
    const me = fx.users.superAdmin.id;
    await as(admin).patch(`/api/v1/admin/users/${me}`, { role: "AUDITOR_READ_ONLY" }).expect(400);
    await as(admin).post(`/api/v1/admin/users/${me}/deactivate`).expect(400);
  });
});
