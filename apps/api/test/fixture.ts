import { PrismaClient, UserRole } from "@prisma/client";

const SCHEMA = process.env.E2E_SCHEMA || "e2e";

/** Every app table in the e2e schema, minus Prisma's own bookkeeping. */
async function appTables(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename <> '_prisma_migrations'`,
    SCHEMA,
  );
  return rows.map((r) => r.tablename);
}

/** Wipe the e2e schema so a spec file starts from a known state. */
export async function resetSchema(prisma: PrismaClient): Promise<void> {
  const tables = await appTables(prisma);
  if (tables.length > 0) {
    const list = tables.map((t) => `"${SCHEMA}"."${t}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  }

  // TRUNCATE ... RESTART IDENTITY only resets sequences owned by a column.
  // The hand-rolled ones (incident_no_seq, problem_no_seq, …) are standalone,
  // so restart them explicitly or numbering drifts across runs.
  const seqs = await prisma.$queryRawUnsafe<{ sequence_name: string }[]>(
    `SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = $1`,
    SCHEMA,
  );
  for (const { sequence_name } of seqs) {
    await prisma.$executeRawUnsafe(`ALTER SEQUENCE "${SCHEMA}"."${sequence_name}" RESTART WITH 1`);
  }
}

export interface Fixture {
  users: Record<
    "superAdmin" | "serviceDesk" | "siteEngineer" | "infraLead",
    { id: string; email: string; role: UserRole }
  >;
  site: { id: string; code: string };
  rack: { id: string };
  ci: { id: string; ciCode: string };
}

/** Minimal data every Dev B e2e spec can rely on: 4 role-holders, a site, a CI. */
export async function seedFixture(prisma: PrismaClient): Promise<Fixture> {
  const mk = (email: string, role: UserRole, displayName: string) =>
    prisma.user.create({
      data: { email, role, displayName, idpSubject: `e2e|${email}` },
    });

  const [superAdmin, serviceDesk, siteEngineer, infraLead] = await Promise.all([
    mk("e2e-admin@example.com", UserRole.SUPER_ADMIN, "E2E Admin"),
    mk("e2e-noc@example.com", UserRole.SERVICE_DESK_NOC, "E2E NOC"),
    mk("e2e-engineer@example.com", UserRole.SITE_ENGINEER, "E2E Engineer"),
    mk("e2e-infra@example.com", UserRole.INFRASTRUCTURE_LEAD, "E2E Infra Lead"),
  ]);

  const site = await prisma.site.create({
    data: { code: "E2E01", name: "E2E Data Center", timezone: "UTC", is247: true },
  });
  const rack = await prisma.rack.create({
    data: { siteId: site.id, rackCode: "R01", name: "E2E Rack 01" },
  });
  const ci = await prisma.configurationItem.create({
    data: {
      ciCode: "E2E01-R01-SRV-001",
      siteId: site.id,
      rackId: rack.id,
      ciType: "SERVER",
      name: "E2E Server 001",
      managedBy: "JSAN",
      criticality: "HIGH",
      lifecycleStatus: "ACTIVE",
    },
  });

  return {
    users: {
      superAdmin: { id: superAdmin.id, email: superAdmin.email, role: superAdmin.role },
      serviceDesk: { id: serviceDesk.id, email: serviceDesk.email, role: serviceDesk.role },
      siteEngineer: { id: siteEngineer.id, email: siteEngineer.email, role: siteEngineer.role },
      infraLead: { id: infraLead.id, email: infraLead.email, role: infraLead.role },
    },
    site: { id: site.id, code: site.code },
    rack: { id: rack.id },
    ci: { id: ci.id, ciCode: ci.ciCode },
  };
}
