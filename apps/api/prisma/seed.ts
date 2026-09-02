import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Sprint 2 seed: a couple of sites and a user per role that matters for
 * RBAC/site-scope testing via POST /auth/dev-login. Extend per §31
 * "Recommended First Development Demo" as CMDB/incident modules land —
 * do not seed production data here.
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

  // eslint-disable-next-line no-console
  console.log(
    `Seeded sites ${site1.code}/${site2.code} and users ${admin.email} (SUPER_ADMIN, all sites), ` +
      `${serviceDesk.email} (SERVICE_DESK_NOC, ${site1.code} only), ` +
      `${siteEngineer.email} (SITE_ENGINEER, ${site2.code} only).`,
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
