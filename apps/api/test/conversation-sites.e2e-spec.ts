import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/**
 * Rubric T2–T4, T9–T12 over HTTP against the real database: the default
 * Assignee Group, a client's report edits in the conversation (client and
 * service desk), and "Delete site" as archive. See
 * docs/runbooks/client-conversation-time-sites.md.
 */
describe("Conversation edits, default group, site delete (e2e)", () => {
  let t: TestApp;
  let fx: Fixture;
  let serviceDesk: { id: string };
  let infra: { id: string };
  let siteC: { id: string; code: string };

  beforeAll(async () => {
    t = await createTestApp();
    await resetSchema(t.prisma);
    fx = await seedFixture(t.prisma);
    await t.prisma.slaPolicy.create({
      data: {
        name: "E2E P2 policy",
        priority: "P2",
        ackTargetMinutes: 15,
        resolveTargetMinutes: 240,
        effectiveFrom: new Date(Date.now() - 86_400_000),
      },
    });
    for (const [i, value] of ["BUG", "CHANGE_REQUEST"].entries()) {
      await t.prisma.issueCatalogOption.create({
        data: { kind: "ISSUE_TYPE", value, label: value, sortOrder: i },
      });
    }
    serviceDesk = await t.prisma.supportGroup.create({
      data: { name: "JSAN ServiceDesk", isClientSelectable: true, isDefaultAssignee: true },
    });
    infra = await t.prisma.supportGroup.create({
      data: { name: "Infra team", isClientSelectable: true },
    });
    // A third site the client can see, to delete during the test.
    siteC = await t.prisma.site.create({
      data: { code: "E2E03", name: "E2E Old Office", timezone: "Europe/London" },
    });
    await t.prisma.userSiteAccess.create({
      data: { userId: fx.users.clientViewer.id, siteId: siteC.id },
    });
  });
  afterAll(async () => {
    await resetSchema(t.prisma);
    await t.close();
  });

  const as = (token: string) => ({ authorization: `Bearer ${token}` });
  const report = (token: string, siteId: string, subject = "UPS alarm in rack 2") =>
    t.http().post("/api/v1/incidents/customer-report").set(as(token)).send({
      siteId,
      issueType: "BUG",
      subject,
      description: "Beeping since 9am",
    });

  describe("T2: JSAN ServiceDesk is the default Assignee Group", () => {
    it("the catalog says so and a new report lands there", async () => {
      const viewer = await t.tokenFor(fx.users.clientViewer.email);
      const catalog = await t
        .http()
        .get("/api/v1/issue-reporting/catalog")
        .set(as(viewer))
        .expect(200);
      expect(catalog.body.defaultAssigneeGroupId).toBe(serviceDesk.id);
      const created = await report(viewer, fx.site.id).expect(201);
      expect(created.body.ownerGroupId).toBe(serviceDesk.id);
    });
  });

  describe("T3/T4: a client's report edit shows in the conversation, old → new", () => {
    let id: string;

    beforeAll(async () => {
      const viewer = await t.tokenFor(fx.users.clientViewer.email);
      id = (await report(viewer, fx.site.id, "Edit me")).body.id;
    });

    it("both the client and the service desk see who changed what, and when (UTC instant)", async () => {
      const viewer = await t.tokenFor(fx.users.clientViewer.email);
      const noc = await t.tokenFor(fx.users.serviceDesk.email);
      const before = Date.now();
      await t
        .http()
        .patch(`/api/v1/incidents/${id}/report`)
        .set(as(viewer))
        .send({ priority: "P2", ownerGroupId: infra.id, subject: "Edited subject" })
        .expect(200);

      for (const token of [viewer, noc]) {
        const progress = await t
          .http()
          .get(`/api/v1/incidents/${id}/progress`)
          .set(as(token))
          .expect(200);
        expect(progress.body.reportEdits).toHaveLength(1);
        const [edit] = progress.body.reportEdits;
        expect(edit.by).toEqual({ name: "E2E Client Viewer", role: "CLIENT_MANAGER_VIEWER" });
        expect(edit.detailed).toBe(true);
        expect(edit.changes).toEqual(
          expect.arrayContaining([
            { label: "Subject", from: "Edit me", to: "Edited subject" },
            { label: "Priority", from: "P3", to: "P2" },
            { label: "Assignee group", from: "JSAN ServiceDesk", to: "Infra team" },
          ]),
        );
        // A real instant in UTC — each viewer's browser shows it in their own zone.
        expect(edit.at).toMatch(/Z$/);
        expect(new Date(edit.at).getTime()).toBeGreaterThanOrEqual(before - 1000);
      }
    });

    it("saving without a real change adds nothing to the conversation", async () => {
      const viewer = await t.tokenFor(fx.users.clientViewer.email);
      await t
        .http()
        .patch(`/api/v1/incidents/${id}/report`)
        .set(as(viewer))
        .send({ priority: "P2", subject: "Edited subject" })
        .expect(200);
      const progress = await t
        .http()
        .get(`/api/v1/incidents/${id}/progress`)
        .set(as(viewer))
        .expect(200);
      expect(progress.body.reportEdits).toHaveLength(1);
    });
  });

  describe("T9–T12: Delete site archives it", () => {
    it("only a Super Admin can delete a site", async () => {
      const noc = await t.tokenFor(fx.users.serviceDesk.email);
      await t.http().post(`/api/v1/sites/${siteC.id}/archive`).set(as(noc)).expect(403);
    });

    it("is refused while the site has open tickets, naming them", async () => {
      const admin = await t.tokenFor(fx.users.superAdmin.email);
      const res = await t
        .http()
        .post(`/api/v1/sites/${fx.site.id}/archive`)
        .set(as(admin))
        .expect(409);
      expect(res.body.message).toMatch(/open ticket/);
      expect(res.body.blockers[0].examples.length).toBeGreaterThan(0);
      const site = await t.prisma.site.findUniqueOrThrow({ where: { id: fx.site.id } });
      expect(site.status).toBe("ACTIVE");
    });

    it("archives an unused site: hidden from lists and the client portal, audited", async () => {
      const admin = await t.tokenFor(fx.users.superAdmin.email);
      const noc = await t.tokenFor(fx.users.serviceDesk.email);
      const viewer = await t.tokenFor(fx.users.clientViewer.email);
      const res = await t
        .http()
        .post(`/api/v1/sites/${siteC.id}/archive`)
        .set(as(admin))
        .expect(200);
      expect(res.body.status).toBe("ARCHIVED");

      const codes = async (token: string, q = "") =>
        (
          await t.http().get(`/api/v1/sites?limit=200${q}`).set(as(token)).expect(200)
        ).body.items.map((s: { code: string }) => s.code);
      expect(await codes(admin)).not.toContain("E2E03");
      expect(await codes(admin, "&includeArchived=true")).toContain("E2E03");
      expect(await codes(noc, "&includeArchived=true")).not.toContain("E2E03"); // admin only
      expect(await codes(viewer)).not.toContain("E2E03");

      const portal = await t
        .http()
        .get("/api/v1/reports/client-portal")
        .set(as(viewer))
        .expect(200);
      expect(JSON.stringify(portal.body)).not.toContain("E2E03");

      expect(
        await t.prisma.auditEvent.count({ where: { entityId: siteC.id, action: "SITE_ARCHIVED" } }),
      ).toBe(1);
    });

    it("takes no new tickets from clients or staff", async () => {
      const viewer = await t.tokenFor(fx.users.clientViewer.email);
      const noc = await t.tokenFor(fx.users.serviceDesk.email);
      const res = await report(viewer, siteC.id).expect(400);
      expect(res.body.message).toMatch(/archived/);
      await t
        .http()
        .post("/api/v1/incidents")
        .set(as(noc))
        .send({
          siteId: siteC.id,
          category: "HARDWARE_FAILURE",
          impact: "HIGH",
          urgency: "HIGH",
          priority: "P3",
          shortDescription: "Should be refused",
        })
        .expect(400);
    });

    it("restore brings it back and it takes tickets again", async () => {
      const admin = await t.tokenFor(fx.users.superAdmin.email);
      const viewer = await t.tokenFor(fx.users.clientViewer.email);
      const res = await t
        .http()
        .post(`/api/v1/sites/${siteC.id}/restore`)
        .set(as(admin))
        .expect(200);
      expect(res.body.status).toBe("ACTIVE");
      await report(viewer, siteC.id).expect(201);
      expect(
        await t.prisma.auditEvent.count({ where: { entityId: siteC.id, action: "SITE_RESTORED" } }),
      ).toBe(1);
    });
  });
});
