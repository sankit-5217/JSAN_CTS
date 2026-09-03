import {
  CiType,
  Criticality,
  LifecycleStatus,
  ManagedBy,
  PrismaClient,
  UserRole,
} from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Sites/users seeded in Sprint 2; a rack and a couple of CIs per site
 * added in Sprint 3 so there's real CMDB data to exercise. Extend per
 * §31 "Recommended First Development Demo" as incidents/SLA land — do
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

  // eslint-disable-next-line no-console
  console.log(
    `Seeded sites ${site1.code}/${site2.code}, users ${admin.email} (SUPER_ADMIN, all sites), ` +
      `${serviceDesk.email} (SERVICE_DESK_NOC, ${site1.code} only), ` +
      `${siteEngineer.email} (SITE_ENGINEER, ${site2.code} only), ` +
      `1 rack and 3 CIs (1 CI-to-CI relation).`,
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
