import {
  CiType,
  Criticality,
  IncidentStatus,
  LifecycleStatus,
  ManagedBy,
  Prisma,
  PrismaClient,
  Priority,
  UserRole,
} from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Sites/users seeded in Sprint 2; a rack and a couple of CIs per site
 * added in Sprint 3; an incident walked through a few transitions plus a
 * comment added in Sprint 4, so there's real ticketing data to exercise.
 * Extend per §31 "Recommended First Development Demo" as SLA lands — do
 * not seed production data here.
 */
async function main() {
  const site1 = await prisma.site.upsert({
    where: { code: "SITE01" },
    update: {},
    create: {
      code: "SITE01",
      name: "Demo Data Center 1",
      timezone: "Asia/Kolkata",
      is247: true,
    },
  });

  const site2 = await prisma.site.upsert({
    where: { code: "SITE02" },
    update: {},
    create: {
      code: "SITE02",
      name: "Demo Data Center 2",
      timezone: "Asia/Kolkata",
      is247: false,
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      idpSubject: "seed-admin",
      email: "admin@example.com",
      displayName: "Seed Admin",
      role: UserRole.SUPER_ADMIN,
    },
  });

  // Service desk: scoped to SITE01 only — exercises the "assigned sites"
  // path in AuthzService rather than the "all sites" admin path.
  const serviceDesk = await prisma.user.upsert({
    where: { email: "servicedesk@example.com" },
    update: {},
    create: {
      idpSubject: "seed-service-desk",
      email: "servicedesk@example.com",
      displayName: "Seed Service Desk",
      role: UserRole.SERVICE_DESK_NOC,
    },
  });

  // Site engineer: scoped to SITE02 only, to prove two scoped users don't
  // see each other's sites.
  const siteEngineer = await prisma.user.upsert({
    where: { email: "engineer@example.com" },
    update: {},
    create: {
      idpSubject: "seed-site-engineer",
      email: "engineer@example.com",
      displayName: "Seed Site Engineer",
      role: UserRole.SITE_ENGINEER,
    },
  });

  // A second engineer scoped to SITE01, so the seeded incident (on
  // server1, SITE01) has an owner who can actually acknowledge/work it —
  // `siteEngineer` above is deliberately SITE02-only.
  const siteEngineer1 = await prisma.user.upsert({
    where: { email: "engineer1@example.com" },
    update: {},
    create: {
      idpSubject: "seed-site-engineer-1",
      email: "engineer1@example.com",
      displayName: "Seed Site Engineer 1",
      role: UserRole.SITE_ENGINEER,
    },
  });

  await prisma.userSiteAccess.upsert({
    where: { userId_siteId: { userId: serviceDesk.id, siteId: site1.id } },
    update: {},
    create: { userId: serviceDesk.id, siteId: site1.id },
  });

  await prisma.userSiteAccess.upsert({
    where: { userId_siteId: { userId: siteEngineer.id, siteId: site2.id } },
    update: {},
    create: { userId: siteEngineer.id, siteId: site2.id },
  });

  await prisma.userSiteAccess.upsert({
    where: { userId_siteId: { userId: siteEngineer1.id, siteId: site1.id } },
    update: {},
    create: { userId: siteEngineer1.id, siteId: site1.id },
  });

  const rack1 = await prisma.rack.upsert({
    where: { siteId_rackCode: { siteId: site1.id, rackCode: "R01" } },
    update: {},
    create: { siteId: site1.id, rackCode: "R01", name: "Rack 01", location: "Row 1, Aisle A" },
  });

  const server1 = await prisma.configurationItem.upsert({
    where: { ciCode: "SITE01-R01-SRV-001" },
    update: {},
    create: {
      ciCode: "SITE01-R01-SRV-001",
      siteId: site1.id,
      rackId: rack1.id,
      ciType: CiType.SERVER,
      name: "SITE01 Rack01 Server001",
      manufacturer: "Dell",
      model: "PowerEdge R750",
      managedBy: ManagedBy.JSAN,
      criticality: Criticality.HIGH,
      lifecycleStatus: LifecycleStatus.ACTIVE,
    },
  });

  const switch1 = await prisma.configurationItem.upsert({
    where: { ciCode: "SITE01-R01-SW-001" },
    update: {},
    create: {
      ciCode: "SITE01-R01-SW-001",
      siteId: site1.id,
      rackId: rack1.id,
      ciType: CiType.SWITCH,
      name: "SITE01 Rack01 Switch001",
      manufacturer: "Cisco",
      managedBy: ManagedBy.JSAN,
      criticality: Criticality.CRITICAL,
      lifecycleStatus: LifecycleStatus.ACTIVE,
    },
  });

  await prisma.ciRelation.upsert({
    where: {
      parentCiId_childCiId_relationType: {
        parentCiId: server1.id,
        childCiId: switch1.id,
        relationType: "DEPENDS_ON",
      },
    },
    update: {},
    create: { parentCiId: server1.id, childCiId: switch1.id, relationType: "DEPENDS_ON" },
  });

  await prisma.configurationItem.upsert({
    where: { ciCode: "SITE02-SRV-001" },
    update: {},
    create: {
      ciCode: "SITE02-SRV-001",
      siteId: site2.id,
      ciType: CiType.SERVER,
      name: "SITE02 Server001",
      manufacturer: "HPE",
      model: "ProLiant DL380",
      managedBy: ManagedBy.CTS,
      criticality: Criticality.MEDIUM,
      lifecycleStatus: LifecycleStatus.ACTIVE,
    },
  });

  // Incident + timeline + comment — only created once (not upserted, since
  // Incident has no natural business key besides incidentNo we'd want to
  // update on reseed). Guarded by a findUnique check so re-running the seed
  // doesn't duplicate incident_events/incident_comments rows each time.
  const existingIncident = await prisma.incident.findUnique({
    where: { incidentNo: "INC-SEED-001" },
  });

  if (!existingIncident) {
    const incident = await prisma.incident.create({
      data: {
        incidentNo: "INC-SEED-001",
        siteId: site1.id,
        ciId: server1.id,
        status: IncidentStatus.IN_PROGRESS,
        priority: Priority.P1,
        category: "HARDWARE_FAILURE",
        impact: "HIGH",
        urgency: "HIGH",
        shortDescription: "SITE01 Rack01 Server001 unresponsive after power event",
        ownerUserId: siteEngineer1.id,
        acknowledgedAt: new Date(),
      },
    });

    await prisma.incidentEvent.createMany({
      data: [
        {
          incidentId: incident.id,
          eventType: "CREATED",
          actorId: serviceDesk.id,
          payload: { status: "NEW" } as Prisma.InputJsonValue,
        },
        {
          incidentId: incident.id,
          eventType: "STATUS_CHANGE",
          actorId: serviceDesk.id,
          payload: { from: "NEW", to: "ASSIGNED" } as Prisma.InputJsonValue,
        },
        {
          incidentId: incident.id,
          eventType: "STATUS_CHANGE",
          actorId: siteEngineer1.id,
          payload: { from: "ASSIGNED", to: "ACKNOWLEDGED" } as Prisma.InputJsonValue,
        },
        {
          incidentId: incident.id,
          eventType: "STATUS_CHANGE",
          actorId: siteEngineer1.id,
          payload: { from: "ACKNOWLEDGED", to: "IN_PROGRESS" } as Prisma.InputJsonValue,
        },
      ],
    });

    await prisma.incidentComment.create({
      data: {
        incidentId: incident.id,
        authorId: siteEngineer1.id,
        body: "Confirmed power event via iDRAC logs; investigating.",
        isInternal: true,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seeded sites ${site1.code}/${site2.code}, users ${admin.email} (SUPER_ADMIN, all sites), ` +
      `${serviceDesk.email} (SERVICE_DESK_NOC, ${site1.code} only), ` +
      `${siteEngineer.email} (SITE_ENGINEER, ${site2.code} only), ` +
      `${siteEngineer1.email} (SITE_ENGINEER, ${site1.code} only), ` +
      `1 rack and 3 CIs (1 CI-to-CI relation), ` +
      `1 incident (INC-SEED-001, IN_PROGRESS, 4 timeline events, 1 comment).`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
