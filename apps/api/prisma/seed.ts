import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Sprint 1 seed: one site, one admin user. Extend per §31 "Recommended First
 * Development Demo" as CMDB/incident modules land — do not seed production
 * data here.
 */
async function main() {
  const site = await prisma.site.upsert({
    where: { code: "SITE01" },
    update: {},
    create: {
      code: "SITE01",
      name: "Demo Data Center 1",
      timezone: "Asia/Kolkata",
      is247: true,
    },
  });

  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      idpSubject: "seed-admin",
      email: "admin@example.com",
      displayName: "Seed Admin",
      role: UserRole.SUPER_ADMIN,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded site ${site.code} and admin user.`);
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
