import {
  CiType,
  Criticality,
  IncidentStatus,
  LifecycleStatus,
  ManagedBy,
  Prisma,
  PrismaClient,
  Priority,
  SlaPolicy,
  SupportCalendar,
  UserRole,
  WorklogActivityType,
} from "@prisma/client";
import { hashPassword, passwordPolicyProblem } from "../src/modules/auth/password-hasher";

const prisma = new PrismaClient();

/**
 * Local/demo sign-in password for every seeded account (override with
 * SEED_DEMO_PASSWORD). Never used in production: the seed refuses to set
 * passwords there — real people choose their own via an emailed invite.
 */
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "OpsDesk-Demo-2026!";

/**
 * Sites/users seeded in Sprint 2; a rack and a couple of CIs per site
 * added in Sprint 3; an incident walked through a few transitions, a
 * comment, and a worklog added in Sprint 4/5; SLA policies, a support
 * calendar per site, and the seeded incident's SLA instance added in
 * Sprint 6; skills, category requirements and engineer shifts for the
 * skill-based routing demo. No seeded attachment — that needs a live MinIO the local dev
 * setup doesn't have running (Sprint 5 plan, Decision 7).
 * Extend per §31 "Recommended First Development Demo" as later sprints
 * land — do not seed production data here.
 */

/**
 * SlaPolicy/SupportCalendar have no natural unique key to `upsert()`
 * against (only `id`), so this is a manual find-or-create — same
 * "guarded, not upserted" idempotency approach as the seeded incident
 * below, just for a table where the guard is a name lookup instead of a
 * findUnique on a real unique column.
 */
async function findOrCreateSlaPolicy(data: Prisma.SlaPolicyCreateInput): Promise<SlaPolicy> {
  const existing = await prisma.slaPolicy.findFirst({ where: { name: data.name } });
  if (existing) {
    return existing;
  }
  return prisma.slaPolicy.create({ data });
}

async function findOrCreateSupportCalendar(
  data: Prisma.SupportCalendarUncheckedCreateInput,
): Promise<SupportCalendar> {
  const existing = await prisma.supportCalendar.findFirst({
    where: { siteId: data.siteId, name: data.name },
  });
  if (existing) {
    return existing;
  }
  return prisma.supportCalendar.create({ data });
}

/** EngineerShift has no natural unique key either — same find-or-create,
 * guarded on engineer + site + label. */
async function findOrCreateShift(data: Prisma.EngineerShiftUncheckedCreateInput): Promise<void> {
  const existing = await prisma.engineerShift.findFirst({
    where: { userId: data.userId, siteId: data.siteId, label: data.label },
  });
  if (!existing) {
    await prisma.engineerShift.create({ data });
  }
}

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
      email: "engineer1@example.com",
      displayName: "Seed Site Engineer 1",
      role: UserRole.SITE_ENGINEER,
    },
  });

  // Client viewer: the customer's own read-only account (CLIENT_MANAGER_VIEWER
  // isn't in AuthzService's ALL_SITES_ROLES, so it needs a UserSiteAccess row
  // just like the scoped internal roles below). Scoped to SITE01 so logging
  // in as this user actually shows something — the seeded incident lives
  // there.
  const clientViewer = await prisma.user.upsert({
    where: { email: "viewer@example.com" },
    update: {},
    create: {
      email: "viewer@example.com",
      displayName: "Seed Client Manager Viewer",
      role: UserRole.CLIENT_MANAGER_VIEWER,
    },
  });

  await prisma.userSiteAccess.upsert({
    where: { userId_siteId: { userId: clientViewer.id, siteId: site1.id } },
    update: {},
    create: { userId: clientViewer.id, siteId: site1.id },
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

  const server2 = await prisma.configurationItem.upsert({
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

  // Health snapshots (spec §10.1's Command Center rollup, Sprint 7) — a
  // deliberate mix so the demo dashboard isn't all-green or all-empty:
  // server1 WARNING (drives SITE01's card to WARNING), switch1 HEALTHY,
  // server2 HEALTHY (SITE02 stays HEALTHY). One row per CI (upsert on the
  // unique ciId), not guarded like the incident block — these are
  // idempotent by nature.
  await prisma.healthSnapshot.upsert({
    where: { ciId: server1.id },
    update: {},
    create: { ciId: server1.id, overallHealth: "WARNING", lastHeartbeatAt: new Date() },
  });
  await prisma.healthSnapshot.upsert({
    where: { ciId: switch1.id },
    update: {},
    create: { ciId: switch1.id, overallHealth: "HEALTHY", lastHeartbeatAt: new Date() },
  });
  await prisma.healthSnapshot.upsert({
    where: { ciId: server2.id },
    update: {},
    create: { ciId: server2.id, overallHealth: "HEALTHY", lastHeartbeatAt: new Date() },
  });

  // SLA policies (spec §10.8's illustrative P1-P4 table) and one support
  // calendar per site. SITE01 stays is247 (matching the site's own flag)
  // so its P1/P2 incidents resolve as a flat 24x7 clock; SITE02 is a real
  // 09:00-18:00 Mon-Fri calendar, so a P3/P4 incident there exercises the
  // business-hours math end to end.
  const p1Policy = await findOrCreateSlaPolicy({
    name: "P1 Critical (24x7)",
    priority: Priority.P1,
    ackTargetMinutes: 15,
    resolveTargetMinutes: 4 * 60,
    usesBusinessCalendar: false,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });
  await findOrCreateSlaPolicy({
    name: "P2 High",
    priority: Priority.P2,
    ackTargetMinutes: 30,
    resolveTargetMinutes: 8 * 60,
    usesBusinessCalendar: false,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });
  await findOrCreateSlaPolicy({
    name: "P3 Medium (business hours)",
    priority: Priority.P3,
    ackTargetMinutes: 4 * 60, // 4 business hours
    resolveTargetMinutes: 2 * 9 * 60, // 2 business days at 9h/day
    usesBusinessCalendar: true,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });
  await findOrCreateSlaPolicy({
    name: "P4 Low (business hours)",
    priority: Priority.P4,
    ackTargetMinutes: 9 * 60, // 1 business day
    resolveTargetMinutes: 5 * 9 * 60, // 5 business days at 9h/day
    usesBusinessCalendar: true,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });

  await findOrCreateSupportCalendar({
    siteId: site1.id,
    name: "Standard",
    businessStart: "09:00",
    businessEnd: "18:00",
    workdays: [1, 2, 3, 4, 5],
    holidays: [],
    is247: true,
  });
  await findOrCreateSupportCalendar({
    siteId: site2.id,
    name: "Standard",
    businessStart: "09:00",
    businessEnd: "18:00",
    workdays: [1, 2, 3, 4, 5],
    holidays: [],
    is247: false,
  });

  // Default alert ingestion policy (spec §10.10). Values match the Prisma
  // column defaults / AlertsService code fallback — seeded so operators have a
  // row to tune via PATCH /alert-rules/:id instead of a migration.
  const existingAlertRule = await prisma.alertRule.findFirst({ where: { name: "default" } });
  if (!existingAlertRule) {
    await prisma.alertRule.create({ data: { name: "default" } });
  }

  // Skill-based routing demo (skills Phases 1-2 + routing Phase 3). A second
  // SITE01 engineer so GET /incidents/:id/routing-suggestions has something
  // to rank: on INC-SEED-001 (HARDWARE_FAILURE, owned by siteEngineer1) the
  // new engineer comes first with 0 open incidents and siteEngineer1 shows
  // as current owner. Rahul and Vikas (below) cover the rest of the
  // omnichannel demo.
  const siteEngineer2 = await prisma.user.upsert({
    where: { email: "engineer2@example.com" },
    update: {},
    create: {
      email: "engineer2@example.com",
      displayName: "Seed Site Engineer 2",
      role: UserRole.SITE_ENGINEER,
    },
  });
  await prisma.userSiteAccess.upsert({
    where: { userId_siteId: { userId: siteEngineer2.id, siteId: site1.id } },
    update: {},
    create: { userId: siteEngineer2.id, siteId: site1.id },
  });

  const [hardwareSkill, networkingSkill, storageSkill] = await Promise.all(
    ["Hardware", "Networking", "Storage"].map((name) =>
      prisma.skill.upsert({ where: { name }, update: {}, create: { name } }),
    ),
  );

  const userSkills: [string, string][] = [
    [siteEngineer1.id, hardwareSkill.id],
    [siteEngineer1.id, networkingSkill.id],
    [siteEngineer2.id, hardwareSkill.id],
    [siteEngineer.id, storageSkill.id],
  ];
  for (const [userId, skillId] of userSkills) {
    await prisma.userSkill.upsert({
      where: { userId_skillId: { userId, skillId } },
      update: {},
      create: { userId, skillId },
    });
  }

  const categoryRequirements: [string, string][] = [
    ["HARDWARE_FAILURE", hardwareSkill.id],
    ["NETWORK_OUTAGE", networkingSkill.id],
    ["STORAGE_FAILURE", storageSkill.id],
  ];
  for (const [category, skillId] of categoryRequirements) {
    await prisma.categorySkillRequirement.upsert({
      where: { category_skillId: { category, skillId } },
      update: {},
      create: { category, skillId },
    });
  }

  // Day + night shifts every day so the demo roster is live at whatever
  // hour the seed is run — a single 24h shift isn't representable
  // (startTime === endTime is rejected, see create-shift.dto.ts).
  const everyDay = [0, 1, 2, 3, 4, 5, 6];
  for (const engineer of [siteEngineer1, siteEngineer2]) {
    await findOrCreateShift({
      userId: engineer.id,
      siteId: site1.id,
      label: "Demo day cover",
      daysOfWeek: everyDay,
      startTime: "08:00",
      endTime: "20:00",
    });
    await findOrCreateShift({
      userId: engineer.id,
      siteId: site1.id,
      label: "Demo night cover",
      daysOfWeek: everyDay,
      startTime: "20:00",
      endTime: "08:00",
    });
  }
  await findOrCreateShift({
    userId: siteEngineer.id,
    siteId: site2.id,
    label: "Demo on-call (day)",
    daysOfWeek: everyDay,
    startTime: "08:00",
    endTime: "20:00",
    isOnCall: true,
  });
  await findOrCreateShift({
    userId: siteEngineer.id,
    siteId: site2.id,
    label: "Demo on-call (night)",
    daysOfWeek: everyDay,
    startTime: "20:00",
    endTime: "08:00",
    isOnCall: true,
  });

  // Omnichannel routing demo: two named SITE01 engineers with distinct
  // skills, each owning a team, so an alert or ticket routes to the right
  // person end to end:
  //   Rahul: Windows + Servers    -> Windows & Servers team
  //   Vikas: Storage + Backup     -> Storage & Backup team
  // A "database.down" alert on the demo database server opens a DATABASE
  // incident (the database.down alert rule below), which needs Storage +
  // Backup, so it's offered to Vikas once SITE01's auto-routing is
  // switched on (left off here, like every site's routing by default).
  const rahul = await prisma.user.upsert({
    where: { email: "rahul@example.com" },
    update: {},
    create: {
      email: "rahul@example.com",
      displayName: "Rahul",
      role: UserRole.SITE_ENGINEER,
    },
  });
  const vikas = await prisma.user.upsert({
    where: { email: "vikas@example.com" },
    update: {},
    create: {
      email: "vikas@example.com",
      displayName: "Vikas",
      role: UserRole.SITE_ENGINEER,
    },
  });
  for (const engineer of [rahul, vikas]) {
    await prisma.userSiteAccess.upsert({
      where: { userId_siteId: { userId: engineer.id, siteId: site1.id } },
      update: {},
      create: { userId: engineer.id, siteId: site1.id },
    });
  }

  const [windowsSkill, serversSkill, backupSkill] = await Promise.all(
    ["Windows", "Servers", "Backup"].map((name) =>
      prisma.skill.upsert({ where: { name }, update: {}, create: { name } }),
    ),
  );
  const demoUserSkills: [string, string][] = [
    [rahul.id, windowsSkill.id],
    [rahul.id, serversSkill.id],
    [vikas.id, storageSkill.id],
    [vikas.id, backupSkill.id],
  ];
  for (const [userId, skillId] of demoUserSkills) {
    await prisma.userSkill.upsert({
      where: { userId_skillId: { userId, skillId } },
      update: {},
      create: { userId, skillId },
    });
  }

  const demoCategoryRequirements: [string, string][] = [
    ["SERVER_FAILURE", serversSkill.id],
    ["WINDOWS_OS", windowsSkill.id],
    ["WINDOWS_OS", serversSkill.id],
    ["DATABASE", storageSkill.id],
    ["DATABASE", backupSkill.id],
    ["BACKUP_FAILURE", backupSkill.id],
  ];
  for (const [category, skillId] of demoCategoryRequirements) {
    await prisma.categorySkillRequirement.upsert({
      where: { category_skillId: { category, skillId } },
      update: {},
      create: { category, skillId },
    });
  }

  const [serversTeam, storageTeam] = await Promise.all(
    ["Windows & Servers team", "Storage & Backup team"].map((name) =>
      prisma.supportGroup.upsert({ where: { name }, update: {}, create: { name } }),
    ),
  );
  const teamMembers: [string, string][] = [
    [serversTeam.id, rahul.id],
    [storageTeam.id, vikas.id],
  ];
  for (const [groupId, userId] of teamMembers) {
    await prisma.supportGroupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      update: {},
      create: { groupId, userId },
    });
  }
  const categoryTeams: [string, string][] = [
    ["SERVER_FAILURE", serversTeam.id],
    ["WINDOWS_OS", serversTeam.id],
    ["DATABASE", storageTeam.id],
    ["BACKUP_FAILURE", storageTeam.id],
    ["STORAGE_FAILURE", storageTeam.id],
  ];
  for (const [category, groupId] of categoryTeams) {
    await prisma.categoryTeam.upsert({
      where: { category },
      update: {},
      create: { category, groupId },
    });
  }

  for (const engineer of [rahul, vikas]) {
    await findOrCreateShift({
      userId: engineer.id,
      siteId: site1.id,
      label: "Demo day cover",
      daysOfWeek: everyDay,
      startTime: "08:00",
      endTime: "20:00",
    });
    await findOrCreateShift({
      userId: engineer.id,
      siteId: site1.id,
      label: "Demo night cover",
      daysOfWeek: everyDay,
      startTime: "20:00",
      endTime: "08:00",
    });
  }

  await prisma.configurationItem.upsert({
    where: { ciCode: "SITE01-R01-DB-001" },
    update: {},
    create: {
      ciCode: "SITE01-R01-DB-001",
      siteId: site1.id,
      rackId: rack1.id,
      ciType: CiType.SERVER,
      name: "SITE01 Rack01 Database server",
      manufacturer: "Dell",
      model: "PowerEdge R760",
      managedBy: ManagedBy.JSAN,
      criticality: Criticality.CRITICAL,
      lifecycleStatus: LifecycleStatus.ACTIVE,
    },
  });
  const dbAlertRule = await prisma.alertRule.findFirst({
    where: { name: "demo: database.down" },
  });
  if (!dbAlertRule) {
    await prisma.alertRule.create({
      data: {
        name: "demo: database.down",
        alertType: "database.down",
        autoCreateSeverities: ["CRITICAL"],
        incidentCategory: "DATABASE",
      },
    });
  }

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

    // durationMinutes computed the same way the real create() flow derives
    // it (endedAt - startedAt) rather than hand-picked, so the seeded row
    // matches what the API would actually produce.
    const worklogStartedAt = new Date("2026-09-03T09:15:00Z");
    const worklogEndedAt = new Date("2026-09-03T09:35:00Z");
    await prisma.worklog.create({
      data: {
        incidentId: incident.id,
        engineerId: siteEngineer1.id,
        activityType: WorklogActivityType.REMOTE_WORK,
        startedAt: worklogStartedAt,
        endedAt: worklogEndedAt,
        durationMinutes: Math.round(
          (worklogEndedAt.getTime() - worklogStartedAt.getTime()) / 60000,
        ),
        billable: true,
        notes: "Checked iDRAC event log for power/thermal anomalies.",
      },
    });

    await prisma.incidentEvent.create({
      data: {
        incidentId: incident.id,
        eventType: "WORKLOG",
        actorId: siteEngineer1.id,
        payload: {
          action: "CREATE",
          activityType: "REMOTE_WORK",
          durationMinutes: 20,
        } as Prisma.InputJsonValue,
      },
    });

    // SLA instance computed the same way IncidentsService.create()/
    // createTransition() derive it — a flat 24x7 add (SITE01's calendar is
    // is247) rather than hand-picked, so the seeded row matches what the
    // API would actually produce. ackedAt mirrors the incident's own
    // acknowledgedAt (already set above); resolvedAt stays null — the
    // incident is IN_PROGRESS, not yet resolved.
    await prisma.slaInstance.create({
      data: {
        incidentId: incident.id,
        slaPolicyId: p1Policy.id,
        ackDueAt: new Date(incident.createdAt.getTime() + p1Policy.ackTargetMinutes * 60_000),
        ackedAt: incident.acknowledgedAt,
        resolveDueAt: new Date(
          incident.createdAt.getTime() + p1Policy.resolveTargetMinutes * 60_000,
        ),
      },
    });
  }

  // eslint-disable-next-line no-console
  await setDemoPasswords([
    admin.email,
    serviceDesk.email,
    siteEngineer.email,
    siteEngineer1.email,
    siteEngineer2.email,
    rahul.email,
    vikas.email,
    clientViewer.email,
  ]);

  console.log(
    `Seeded sites ${site1.code}/${site2.code}, users ${admin.email} (SUPER_ADMIN, all sites), ` +
      `${serviceDesk.email} (SERVICE_DESK_NOC, ${site1.code} only), ` +
      `${siteEngineer.email} (SITE_ENGINEER, ${site2.code} only), ` +
      `${siteEngineer1.email} (SITE_ENGINEER, ${site1.code} only), ` +
      `${siteEngineer2.email} (SITE_ENGINEER, ${site1.code} only), ` +
      `${rahul.email} (Windows + Servers) and ${vikas.email} (Storage + Backup) ` +
      `(SITE_ENGINEER, ${site1.code}, each owning a team), ` +
      `${clientViewer.email} (CLIENT_MANAGER_VIEWER, ${site1.code} only), ` +
      `1 rack and 4 CIs (1 CI-to-CI relation, 3 health snapshots), ` +
      `4 SLA policies (P1-P4) and 1 support calendar per site, ` +
      `6 skills, 8 engineer-skill assignments, 9 category requirements, 10 demo shifts, ` +
      `2 demo teams with 5 category -> team mappings, a database.down alert rule, ` +
      `1 incident (INC-SEED-001, IN_PROGRESS, 5 timeline events, 1 comment, 1 worklog, 1 SLA instance).`,
  );
}

/** Gives seeded accounts the demo password — only those still without one. */
async function setDemoPasswords(emails: string[]): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    // eslint-disable-next-line no-console
    console.warn("NODE_ENV=production: not setting demo passwords on seeded accounts.");
    return;
  }
  const problem = passwordPolicyProblem(DEMO_PASSWORD, "seed@example.com");
  if (problem) throw new Error(`SEED_DEMO_PASSWORD rejected: ${problem}`);
  const { count } = await prisma.user.updateMany({
    where: { email: { in: emails }, passwordHash: null },
    data: { passwordHash: await hashPassword(DEMO_PASSWORD), passwordSetAt: new Date() },
  });
  // eslint-disable-next-line no-console
  console.log(`Demo password set on ${count} seeded account(s) (sign in with ${DEMO_PASSWORD}).`);
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
