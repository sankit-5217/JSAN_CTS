import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { IssueCatalogKind, UserRole } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { IssueReportingService } from "./issue-reporting.service";

const option = (
  kind: IssueCatalogKind,
  value: string,
  extra: Partial<{ id: string; label: string; parentId: string | null; isActive: boolean }> = {},
) => ({
  id: extra.id ?? `${kind}:${value}`,
  kind,
  value,
  label: extra.label ?? value,
  parentId: extra.parentId ?? null,
  sortOrder: 0,
  isActive: extra.isActive ?? true,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
});

const SERVER = option(IssueCatalogKind.COMPONENT, "SERVER", { id: "cmp-server", label: "Server" });
const NETWORK = option(IssueCatalogKind.COMPONENT, "NETWORK", {
  id: "cmp-network",
  label: "Network",
});
const PSU = option(IssueCatalogKind.SUB_COMPONENT, "SERVER.PSU", {
  label: "Power supply",
  parentId: "cmp-server",
});
const CATALOG = [
  option(IssueCatalogKind.ISSUE_TYPE, "HARDWARE_FAILURE", { id: "it-hw" }),
  option(IssueCatalogKind.PRIORITY, "P1"),
  option(IssueCatalogKind.SEVERITY, "MAJOR"),
  SERVER,
  NETWORK,
  PSU,
  option(IssueCatalogKind.TOOL, "VISUAL"),
];

function makeService(overrides: Record<string, unknown> = {}) {
  const tx = {
    issueCatalogOption: {
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: "opt-new", ...data })),
      update: jest
        .fn()
        .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
    },
    issueTemplate: {
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve({ id: "tpl-new", ...data })),
      update: jest
        .fn()
        .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    issueCatalogOption: {
      // Matches the service's `OR: [{kind, value}, ...]` + isActive filter.
      findMany: jest.fn().mockImplementation(({ where }) => {
        const wanted = (where?.OR ?? []) as { kind: IssueCatalogKind; value: string }[];
        const active = CATALOG.filter((o) => (where?.isActive === undefined ? true : o.isActive));
        return Promise.resolve(
          wanted.length === 0
            ? active
            : active.filter((o) => wanted.some((w) => w.kind === o.kind && w.value === o.value)),
        );
      }),
      findUnique: jest.fn().mockImplementation(({ where }) => {
        if (where.id) return Promise.resolve(CATALOG.find((o) => o.id === where.id) ?? null);
        const { kind, value } = where.kind_value;
        return Promise.resolve(CATALOG.find((o) => o.kind === kind && o.value === value) ?? null);
      }),
    },
    issueTemplate: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    supportGroup: {
      findFirst: jest.fn().mockResolvedValue({ id: "grp-desk", name: "JSAN ServiceDesk" }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    supportGroupMember: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    incident: { findUnique: jest.fn().mockResolvedValue(null) },
    ...overrides,
  } as unknown as PrismaService;
  const auditService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  return { service: new IssueReportingService(prisma, auditService), prisma, auditService, tx };
}

const actor = { actorId: "admin-1" };

describe("IssueReportingService.getCatalog", () => {
  it("groups active options by kind, nests sub components under their component, and names the default group", async () => {
    const { service } = makeService();
    const catalog = await service.getCatalog();
    expect(catalog.issueTypes.map((o) => o.value)).toEqual(["HARDWARE_FAILURE"]);
    expect(catalog.priorities.map((o) => o.value)).toEqual(["P1"]);
    expect(catalog.components).toEqual([
      expect.objectContaining({
        value: "SERVER",
        subComponents: [expect.objectContaining({ value: "SERVER.PSU", label: "Power supply" })],
      }),
      expect.objectContaining({ value: "NETWORK", subComponents: [] }),
    ]);
    expect(catalog.tools.map((o) => o.value)).toEqual(["VISUAL"]);
    expect(catalog.defaultAssigneeGroupId).toBe("grp-desk");
  });
});

describe("IssueReportingService.assertValidSelections", () => {
  it("accepts a consistent set of active values", async () => {
    const { service } = makeService();
    await expect(
      service.assertValidSelections(
        {
          issueType: "HARDWARE_FAILURE",
          severity: "MAJOR",
          component: "SERVER",
          subComponent: "SERVER.PSU",
          tool: "VISUAL",
        },
        { requireIssueType: true },
      ),
    ).resolves.toBeUndefined();
  });

  it("requires an issue type on a client report", async () => {
    const { service } = makeService();
    await expect(
      service.assertValidSelections({ severity: "MAJOR" }, { requireIssueType: true }),
    ).rejects.toThrow("Issue type is required");
  });

  it("rejects a value that is not in the catalog, naming the field", async () => {
    const { service } = makeService();
    await expect(service.assertValidSelections({ severity: "URGENT" })).rejects.toThrow(
      'Severity "URGENT" is not an available option',
    );
  });

  it("rejects a sub component that belongs to a different component", async () => {
    const { service } = makeService();
    await expect(
      service.assertValidSelections({ component: "NETWORK", subComponent: "SERVER.PSU" }),
    ).rejects.toThrow('does not belong to component "Network"');
  });

  it("rejects a sub component without its component", async () => {
    const { service } = makeService();
    await expect(
      service.assertValidSelections({ subComponent: "SERVER.PSU" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("does nothing when no pick-list field was supplied", async () => {
    const { service, prisma } = makeService();
    await service.assertValidSelections({});
    expect(prisma.issueCatalogOption.findMany).not.toHaveBeenCalled();
  });
});

describe("IssueReportingService.resolveAssignment", () => {
  it("falls back to the default (Service Desk) group when none was picked", async () => {
    const { service } = makeService();
    await expect(service.resolveAssignment(undefined, undefined)).resolves.toEqual({
      ownerGroupId: "grp-desk",
      ownerUserId: null,
    });
  });

  it("leaves the ticket unowned when no default group is flagged", async () => {
    const { service } = makeService({
      supportGroup: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn() },
    });
    await expect(service.resolveAssignment(undefined, undefined)).resolves.toEqual({
      ownerGroupId: null,
      ownerUserId: null,
    });
  });

  it("rejects an unknown group", async () => {
    const { service } = makeService();
    await expect(service.resolveAssignment("grp-nope", undefined)).rejects.toThrow(
      "Unknown assignee group",
    );
  });

  it("accepts an assignee who is an active staff member of the chosen group", async () => {
    const { service } = makeService({
      supportGroup: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ id: "grp-storage", name: "Storage" }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "eng-1",
          displayName: "Vikas",
          isActive: true,
          role: UserRole.SITE_ENGINEER,
        }),
      },
      supportGroupMember: { findUnique: jest.fn().mockResolvedValue({ id: "m-1" }) },
    });
    await expect(service.resolveAssignment("grp-storage", "eng-1")).resolves.toEqual({
      ownerGroupId: "grp-storage",
      ownerUserId: "eng-1",
    });
  });

  it("rejects an assignee outside the group, a customer, or a deactivated user", async () => {
    const outsider = makeService({
      supportGroup: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ id: "grp-storage", name: "Storage" }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "eng-1",
          displayName: "Vikas",
          isActive: true,
          role: UserRole.SITE_ENGINEER,
        }),
      },
    });
    await expect(outsider.service.resolveAssignment("grp-storage", "eng-1")).rejects.toThrow(
      "Vikas is not a member of Storage",
    );

    const customer = makeService({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "cust-1",
          displayName: "Jane",
          isActive: true,
          role: UserRole.CLIENT_MANAGER_VIEWER,
        }),
      },
    });
    await expect(customer.service.resolveAssignment(undefined, "cust-1")).rejects.toThrow(
      "Assignee must be an active staff member",
    );
  });
});

describe("IssueReportingService.resolveRefIncidentNo", () => {
  it("normalizes a bare number to INC-000123 and checks the ticket exists", async () => {
    const { service, prisma } = makeService({
      incident: { findUnique: jest.fn().mockResolvedValue({ incidentNo: "INC-000123" }) },
    });
    await expect(service.resolveRefIncidentNo(" 123 ")).resolves.toBe("INC-000123");
    expect(prisma.incident.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { incidentNo: "INC-000123" } }),
    );
  });

  it("rejects a reference to a ticket that does not exist", async () => {
    const { service } = makeService();
    await expect(service.resolveRefIncidentNo("inc-000999")).rejects.toThrow(
      "No ticket INC-000999 exists",
    );
  });

  it("accepts any existing ticket number, not just the INC-nnnnnn sequence shape", async () => {
    const { service } = makeService({
      incident: { findUnique: jest.fn().mockResolvedValue({ incidentNo: "INC-SEED-001" }) },
    });
    await expect(service.resolveRefIncidentNo("inc-seed-001")).resolves.toBe("INC-SEED-001");
  });
});

describe("IssueReportingService.normalizeCcEmails", () => {
  it("lower-cases, trims and de-duplicates", () => {
    const { service } = makeService();
    expect(
      service.normalizeCcEmails([
        " Ops@Client.example",
        "ops@client.example",
        "lead@client.example",
      ]),
    ).toEqual(["ops@client.example", "lead@client.example"]);
  });

  it("caps the list", () => {
    const { service } = makeService();
    const many = Array.from({ length: 21 }, (_, i) => `u${i}@client.example`);
    expect(() => service.normalizeCcEmails(many)).toThrow(BadRequestException);
  });
});

describe("IssueReportingService admin writes", () => {
  it("creates an option and audits it in the same transaction", async () => {
    const { service, tx, auditService } = makeService();
    await service.createOption(
      { kind: IssueCatalogKind.TOOL, value: "GRAFANA", label: " Grafana " },
      actor,
    );
    expect(tx.issueCatalogOption.create).toHaveBeenCalledWith({
      data: {
        kind: IssueCatalogKind.TOOL,
        value: "GRAFANA",
        label: "Grafana",
        parentId: undefined,
        sortOrder: 0,
      },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "IssueCatalogOption", action: "CREATE" }),
      tx,
    );
  });

  it("refuses a duplicate value within a kind", async () => {
    const { service } = makeService();
    await expect(
      service.createOption({ kind: IssueCatalogKind.TOOL, value: "VISUAL", label: "x" }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("requires a sub component to sit under a COMPONENT option", async () => {
    const { service } = makeService();
    await expect(
      service.createOption(
        { kind: IssueCatalogKind.SUB_COMPONENT, value: "NETWORK.SWITCH", label: "Switch" },
        actor,
      ),
    ).rejects.toThrow("needs the component");
    await expect(
      service.createOption(
        {
          kind: IssueCatalogKind.SUB_COMPONENT,
          value: "NETWORK.SWITCH",
          label: "Switch",
          parentId: "it-hw",
        },
        actor,
      ),
    ).rejects.toThrow("parentId must be a COMPONENT option");
  });

  it("only lets a PRIORITY option re-label P1..P4", async () => {
    const { service } = makeService();
    await expect(
      service.createOption(
        { kind: IssueCatalogKind.PRIORITY, value: "P0", label: "Blocker" },
        actor,
      ),
    ).rejects.toThrow("re-label one of P1, P2, P3, P4");
  });

  it("creates one template per issue type, validating its defaults against the catalog", async () => {
    const { service, tx } = makeService();
    await service.createTemplate(
      {
        issueTypeId: "it-hw",
        name: "Hardware fault",
        descriptionDraft: "Device:\nSymptom:",
        defaultComponent: "SERVER",
        defaultSubComponent: "SERVER.PSU",
      },
      actor,
    );
    expect(tx.issueTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ issueTypeId: "it-hw" }) }),
    );

    const { service: dup } = makeService({
      issueTemplate: {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ id: "tpl-1", issueTypeId: "it-hw" }),
      },
    });
    await expect(
      dup.createTemplate({ issueTypeId: "it-hw", name: "Again", descriptionDraft: "x" }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("updateTemplate validates the merged defaults and lets an empty string clear one", async () => {
    const { service, tx } = makeService({
      issueTemplate: {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          id: "tpl-1",
          issueTypeId: "it-hw",
          name: "Hardware fault",
          subjectDraft: null,
          descriptionDraft: "x",
          defaultPriority: "P2",
          defaultSeverity: "MAJOR",
          defaultComponent: "SERVER",
          defaultSubComponent: "SERVER.PSU",
          defaultTool: null,
          isActive: true,
        }),
      },
    });
    // Clearing the component while the sub component stays is inconsistent.
    await expect(service.updateTemplate("tpl-1", { defaultComponent: "" }, actor)).rejects.toThrow(
      "A sub component needs its component",
    );
    await service.updateTemplate(
      "tpl-1",
      { defaultComponent: "", defaultSubComponent: "", defaultPriority: "P3" },
      actor,
    );
    expect(tx.issueTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          defaultComponent: null,
          defaultSubComponent: null,
          defaultPriority: "P3",
          defaultSeverity: "MAJOR",
        }),
      }),
    );
  });

  it("404s an unknown option or template on update", async () => {
    const { service } = makeService();
    await expect(service.updateOption("nope", { label: "x" }, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.updateTemplate("nope", { name: "x" }, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
