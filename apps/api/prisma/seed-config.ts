import { IssueCatalogKind, Prisma, PrismaClient, Priority, SlaPolicy } from "@prisma/client";

/**
 * Reference configuration a real deployment needs before anyone can raise an
 * issue: SLA policies P1-P4, the default alert ingestion rule, the two
 * Assignee Groups and the "Report an issue" pick-lists and templates. No
 * sites, users, CIs or incidents — safe to run against production, and the
 * demo seed (seed.ts) calls it too.
 *
 * Everything is find-or-create / upsert with `update: {}`, so re-running it
 * never overwrites an admin's later edits in the UI.
 *
 *   production:  railway ssh --service api -- "cd /app/apps/api && npx ts-node prisma/seed-config.ts"
 *   local:       pnpm --filter @cts-dc-opsdesk/api exec ts-node prisma/seed-config.ts
 */
export async function seedConfiguration(prisma: PrismaClient): Promise<void> {
  await seedSlaPolicies(prisma);
  await seedDefaultAlertRule(prisma);
  await seedIssueReporting(prisma);
}

/**
 * SlaPolicy has no natural unique key to `upsert()` against (only `id`), so
 * this is a manual find-or-create guarded on the policy name.
 */
async function findOrCreateSlaPolicy(
  prisma: PrismaClient,
  data: Prisma.SlaPolicyCreateInput,
): Promise<SlaPolicy> {
  const existing = await prisma.slaPolicy.findFirst({ where: { name: data.name } });
  if (existing) {
    return existing;
  }
  return prisma.slaPolicy.create({ data });
}

/** Spec §10.8's illustrative P1-P4 table; tune in the UI afterwards. */
async function seedSlaPolicies(prisma: PrismaClient) {
  await findOrCreateSlaPolicy(prisma, {
    name: "P1 Critical (24x7)",
    priority: Priority.P1,
    ackTargetMinutes: 15,
    resolveTargetMinutes: 4 * 60,
    usesBusinessCalendar: false,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });
  await findOrCreateSlaPolicy(prisma, {
    name: "P2 High",
    priority: Priority.P2,
    ackTargetMinutes: 30,
    resolveTargetMinutes: 8 * 60,
    usesBusinessCalendar: false,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });
  await findOrCreateSlaPolicy(prisma, {
    name: "P3 Medium (business hours)",
    priority: Priority.P3,
    ackTargetMinutes: 4 * 60, // 4 business hours
    resolveTargetMinutes: 2 * 9 * 60, // 2 business days at 9h/day
    usesBusinessCalendar: true,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });
  await findOrCreateSlaPolicy(prisma, {
    name: "P4 Low (business hours)",
    priority: Priority.P4,
    ackTargetMinutes: 9 * 60, // 1 business day
    resolveTargetMinutes: 5 * 9 * 60, // 5 business days at 9h/day
    usesBusinessCalendar: true,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });
}

/**
 * Default alert ingestion policy (spec §10.10). Values match the Prisma
 * column defaults / AlertsService code fallback — seeded so operators have a
 * row to tune via PATCH /alert-rules/:id instead of a migration.
 */
async function seedDefaultAlertRule(prisma: PrismaClient) {
  const existing = await prisma.alertRule.findFirst({ where: { name: "default" } });
  if (!existing) {
    await prisma.alertRule.create({ data: { name: "default" } });
  }
}

/**
 * The "Report an issue" template configuration (client portal): the default
 * Assignee Group, the pick-list catalog and one auto-draft template per
 * issue type. Upserts keyed on (kind, value) / issue type.
 */
async function seedIssueReporting(prisma: PrismaClient) {
  // The two Assignee Groups a client can pick on the issue template.
  const serviceDeskGroup = await prisma.supportGroup.upsert({
    where: { name: "JSAN ServiceDesk" },
    update: {},
    create: { name: "JSAN ServiceDesk", isClientSelectable: true },
  });
  await prisma.supportGroup.upsert({
    where: { name: "Infra team" },
    update: {},
    create: { name: "Infra team", isClientSelectable: true },
  });
  const currentDefault = await prisma.supportGroup.findFirst({
    where: { isDefaultAssignee: true },
  });
  if (!currentDefault) {
    await prisma.supportGroup.update({
      where: { id: serviceDeskGroup.id },
      data: { isDefaultAssignee: true },
    });
  }

  const option = async (
    kind: IssueCatalogKind,
    value: string,
    label: string,
    sortOrder: number,
    parentId?: string,
  ) =>
    prisma.issueCatalogOption.upsert({
      where: { kind_value: { kind, value } },
      update: {},
      create: { kind, value, label, sortOrder, parentId },
    });

  // Issue types and templates are the same list, one template each.
  const issueTypes: [string, string][] = [
    ["BUG", "Bug"],
    ["PROCESS_REQUEST", "Process request"],
    ["CHANGE_REQUEST", "Change request"],
    ["FEATURE_REQUEST", "Feature request"],
    ["OTHER_REQUEST", "Other request"],
  ];
  const issueTypeRows = new Map<string, string>();
  for (const [i, [value, label]] of issueTypes.entries()) {
    const row = await option(IssueCatalogKind.ISSUE_TYPE, value, label, i);
    issueTypeRows.set(value, row.id);
  }

  const priorities: [Priority, string][] = [
    [Priority.P1, "P1 - Critical"],
    [Priority.P2, "P2 - High"],
    [Priority.P3, "P3 - Standard"],
    [Priority.P4, "P4 - Low"],
  ];
  for (const [i, [value, label]] of priorities.entries()) {
    await option(IssueCatalogKind.PRIORITY, value, label, i);
  }

  const severities: [string, string][] = [
    ["S0", "S0"],
    ["S1", "S1"],
    ["S2", "S2"],
    ["S3", "S3"],
  ];
  for (const [i, [value, label]] of severities.entries()) {
    await option(IssueCatalogKind.SEVERITY, value, label, i);
  }

  const components: [string, string, [string, string][]][] = [
    [
      "HW",
      "Hardware",
      [
        ["SERVER", "HW-Server"],
        ["FIREWALL", "Firewall"],
        ["PDU", "PDU"],
        ["UPS", "UPS"],
        ["OTHERS", "Others"],
      ],
    ],
    [
      "SW",
      "Software",
      [
        ["SW1", "SW1"],
        ["SW2", "SW2"],
        ["SW3", "SW3"],
        ["OS", "OS"],
        ["FIRMWARE", "Firmware"],
      ],
    ],
    [
      "NW",
      "NW",
      [
        ["ISP", "ISP"],
        ["FW", "FW"],
        ["WIFI", "Wifi"],
      ],
    ],
    [
      "OTHERS",
      "Others",
      [
        ["POWER", "Power"],
        ["AC", "AC"],
        ["CCTV", "CCTV"],
      ],
    ],
    [
      "TOOLS",
      "Tools",
      [
        ["DRIVEFLUX", "DriveFlux"],
        ["DISKSQUAD", "DiskSquad"],
        ["ANYDESK", "Anydesk"],
        ["OTHERS", "Others"],
      ],
    ],
  ];
  for (const [i, [value, label, subs]] of components.entries()) {
    const component = await option(IssueCatalogKind.COMPONENT, value, label, i);
    for (const [j, [subValue, subLabel]] of subs.entries()) {
      await option(
        IssueCatalogKind.SUB_COMPONENT,
        `${value}.${subValue}`,
        subLabel,
        j,
        component.id,
      );
    }
  }

  const templates: {
    issueType: string;
    name: string;
    subjectDraft: string;
    descriptionDraft: string;
    defaultPriority: Priority;
    defaultSeverity?: string;
    defaultComponent?: string;
    defaultSubComponent?: string;
    defaultTool?: string;
  }[] = [
    {
      issueType: "BUG",
      name: "Bug",
      subjectDraft: "[Bug] <system / device> - <what is wrong>",
      descriptionDraft:
        "What is wrong:\n\nSteps to reproduce:\n1. \n\nExpected result:\n\nActual result:\n\nWhen did it start?\n\nAlready tried:\n",
      defaultPriority: Priority.P3,
    },
    {
      issueType: "PROCESS_REQUEST",
      name: "Process request",
      subjectDraft: "[Process] <process> - <what you need>",
      descriptionDraft:
        "Which process:\n\nWhat you need done:\n\nNeeded by (date / time):\n\nApprovals (if any):\n",
      defaultPriority: Priority.P3,
    },
    {
      issueType: "CHANGE_REQUEST",
      name: "Change request",
      subjectDraft: "[Change] <system / device> - <change>",
      descriptionDraft:
        "What should change:\n\nWhy (business reason):\n\nAffected systems / devices:\n\nPreferred maintenance window:\n\nRollback plan:\n",
      defaultPriority: Priority.P3,
    },
    {
      issueType: "FEATURE_REQUEST",
      name: "Feature request",
      subjectDraft: "[Feature] <what you would like>",
      descriptionDraft: "What you would like:\n\nWhy it helps:\n\nWho will use it:\n",
      defaultPriority: Priority.P3,
    },
    {
      issueType: "OTHER_REQUEST",
      name: "Other request",
      subjectDraft: "[Request] <short summary>",
      descriptionDraft: "What you need:\n\nAny details that help:\n",
      defaultPriority: Priority.P3,
    },
  ];
  for (const t of templates) {
    const issueTypeId = issueTypeRows.get(t.issueType);
    if (!issueTypeId) continue;
    await prisma.issueTemplate.upsert({
      where: { issueTypeId },
      update: {},
      create: {
        issueTypeId,
        name: t.name,
        subjectDraft: t.subjectDraft || null,
        descriptionDraft: t.descriptionDraft,
        defaultPriority: t.defaultPriority,
        defaultSeverity: t.defaultSeverity,
        defaultComponent: t.defaultComponent,
        defaultSubComponent: t.defaultSubComponent,
        defaultTool: t.defaultTool,
      },
    });
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedConfiguration(prisma)
    .then(() => {
      // eslint-disable-next-line no-console
      console.log("Reference configuration seeded (SLA policies, alert rule, issue reporting).");
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
