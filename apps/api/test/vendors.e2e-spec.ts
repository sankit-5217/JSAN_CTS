import { createTestApp, TestApp } from "./app";
import { Fixture, resetSchema, seedFixture } from "./fixture";

/** Vendor case + RMA dispatch lifecycle over HTTP (spec §10.13). */
describe("Vendors API (e2e)", () => {
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

  it("runs a case from open to closed through the dispatch lifecycle", async () => {
    const vendor = await t
      .http()
      .post("/api/v1/vendors")
      .set("authorization", `Bearer ${token}`)
      .send({ name: "Dell E2E", type: "DELL" })
      .expect(201);

    const open = await t
      .http()
      .post("/api/v1/vendor-cases")
      .set("authorization", `Bearer ${token}`)
      .send({
        vendorCaseNo: "SR-E2E-1",
        vendorId: vendor.body.id,
        ciId: fx.ci.id,
        rmaRequired: true,
        replacementPart: "PowerEdge 800W PSU",
      })
      .expect(201);
    const caseId = open.body.id;

    // duplicate vendorCaseNo is rejected
    await t
      .http()
      .post("/api/v1/vendor-cases")
      .set("authorization", `Bearer ${token}`)
      .send({ vendorCaseNo: "SR-E2E-1", vendorId: vendor.body.id })
      .expect(409);

    // advance the RMA dispatch state machine
    for (const dispatchStatus of ["REQUESTED", "APPROVED", "SHIPPED", "DELIVERED", "INSTALLED"]) {
      await t
        .http()
        .patch(`/api/v1/vendor-cases/${caseId}`)
        .set("authorization", `Bearer ${token}`)
        .send({ dispatchStatus })
        .expect(200);
    }

    await t
      .http()
      .post(`/api/v1/vendor-cases/${caseId}/updates`)
      .set("authorization", `Bearer ${token}`)
      .send({ note: "Part fitted, server back in service" })
      .expect(201);

    const closed = await t
      .http()
      .patch(`/api/v1/vendor-cases/${caseId}`)
      .set("authorization", `Bearer ${token}`)
      .send({ closeOutcome: "Replaced PSU under warranty; RMA complete" })
      .expect(200);
    expect(closed.body.dispatchStatus).toBe("INSTALLED");

    const fetched = await t
      .http()
      .get(`/api/v1/vendor-cases/${caseId}`)
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(fetched.body.closedAt).toBeTruthy();
  });

  it("rejects an out-of-order dispatch transition", async () => {
    const vendor = await t
      .http()
      .post("/api/v1/vendors")
      .set("authorization", `Bearer ${token}`)
      .send({ name: "HPE E2E", type: "HPE" })
      .expect(201);
    const c = await t
      .http()
      .post("/api/v1/vendor-cases")
      .set("authorization", `Bearer ${token}`)
      .send({ vendorCaseNo: "SR-E2E-2", vendorId: vendor.body.id })
      .expect(201);

    // jump straight to INSTALLED without REQUESTED/APPROVED/... — server rejects
    await t
      .http()
      .patch(`/api/v1/vendor-cases/${c.body.id}`)
      .set("authorization", `Bearer ${token}`)
      .send({ dispatchStatus: "INSTALLED" })
      .expect(400);
  });
});
