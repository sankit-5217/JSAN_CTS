import { describe, expect, it } from "vitest";
import {
  applyTemplate,
  draftProblems,
  EMPTY_DRAFT,
  normalizeRefIncidentNo,
  parseCcList,
  templateForIssueType,
  toRequestBody,
  type IssueCatalog,
  type IssueTemplate,
} from "./issueReporting";

const option = (id: string, value: string, parentId: string | null = null) => ({
  id,
  value,
  label: value,
  parentId,
  sortOrder: 0,
  isActive: true,
});

const hardware: IssueTemplate = {
  id: "tpl-hw",
  issueTypeId: "it-hw",
  name: "Hardware fault",
  subjectDraft: "[Hardware] <device> - <symptom>",
  descriptionDraft: "Device:\nSymptom:",
  defaultPriority: "P2" as IssueTemplate["defaultPriority"],
  defaultSeverity: "MAJOR",
  defaultComponent: "SERVER",
  defaultSubComponent: "SERVER.PSU",
  defaultTool: "VISUAL",
  isActive: true,
};

const network: IssueTemplate = {
  ...hardware,
  id: "tpl-net",
  issueTypeId: "it-net",
  name: "Network",
  subjectDraft: "[Network] <what>",
  descriptionDraft: "Affected:",
  defaultComponent: "NETWORK",
  defaultSubComponent: null,
};

const catalog: IssueCatalog = {
  issueTypes: [option("it-hw", "HARDWARE_FAILURE"), option("it-net", "NETWORK")],
  priorities: [option("p1", "P1"), option("p2", "P2")],
  severities: [option("s1", "MAJOR")],
  components: [
    {
      ...option("c-server", "SERVER"),
      subComponents: [option("sc-psu", "SERVER.PSU", "c-server")],
    },
    { ...option("c-net", "NETWORK"), subComponents: [] },
  ],
  tools: [option("t1", "VISUAL")],
  templates: [hardware, network],
  defaultAssigneeGroupId: "grp-desk",
};

describe("applyTemplate", () => {
  it("fills the issue type, drafts and defaults from the template", () => {
    const draft = applyTemplate(EMPTY_DRAFT, hardware, catalog);
    expect(draft).toMatchObject({
      templateId: "tpl-hw",
      issueType: "HARDWARE_FAILURE",
      subject: "[Hardware] <device> - <symptom>",
      description: "Device:\nSymptom:",
      priority: "P2",
      severity: "MAJOR",
      component: "SERVER",
      subComponent: "SERVER.PSU",
      tool: "VISUAL",
    });
  });

  it("swaps one template's drafts for another's, but never overwrites text the reporter typed", () => {
    const fromHardware = applyTemplate(EMPTY_DRAFT, hardware, catalog);
    const swapped = applyTemplate(fromHardware, network, catalog);
    expect(swapped.subject).toBe("[Network] <what>");
    expect(swapped.description).toBe("Affected:");
    expect(swapped.component).toBe("NETWORK");
    expect(swapped.subComponent).toBe("");

    const typed = { ...fromHardware, subject: "PSU LED is red", description: "Rack 3, slot 2" };
    const kept = applyTemplate(typed, network, catalog);
    expect(kept.subject).toBe("PSU LED is red");
    expect(kept.description).toBe("Rack 3, slot 2");
    expect(kept.issueType).toBe("NETWORK");
  });

  it("clearing the template clears only its own drafts", () => {
    const fromHardware = applyTemplate(EMPTY_DRAFT, hardware, catalog);
    const cleared = applyTemplate(fromHardware, null, catalog);
    expect(cleared.templateId).toBe("");
    expect(cleared.subject).toBe("");
    expect(cleared.description).toBe("");
    expect(cleared.issueType).toBe("HARDWARE_FAILURE");
  });

  it("finds the template behind an issue type", () => {
    expect(templateForIssueType(catalog, "NETWORK")?.id).toBe("tpl-net");
    expect(templateForIssueType(catalog, "NOPE")).toBeNull();
  });
});

describe("parseCcList", () => {
  it("splits on commas, semicolons, spaces and newlines, lower-casing and de-duplicating", () => {
    expect(parseCcList("A@x.io, b@x.io;c@x.io\n a@x.io <d@x.io>")).toEqual({
      emails: ["a@x.io", "b@x.io", "c@x.io", "d@x.io"],
      invalid: [],
    });
  });

  it("reports what it couldn't read instead of dropping it silently", () => {
    expect(parseCcList("ops@x.io, not-an-email")).toEqual({
      emails: ["ops@x.io"],
      invalid: ["not-an-email"],
    });
  });
});

describe("normalizeRefIncidentNo", () => {
  it("accepts a bare number or a lower-case id", () => {
    expect(normalizeRefIncidentNo("42")).toBe("INC-000042");
    expect(normalizeRefIncidentNo(" inc-000042 ")).toBe("INC-000042");
  });
});

describe("draftProblems", () => {
  it("lists what is missing in form order", () => {
    expect(draftProblems(EMPTY_DRAFT, "")).toEqual([
      "Pick the site the issue is at",
      "Pick an issue type (or a template)",
      "Give the issue a subject",
    ]);
  });

  it("is empty for a complete draft", () => {
    const draft = { ...applyTemplate(EMPTY_DRAFT, hardware, catalog), subject: "PSU failed" };
    expect(draftProblems(draft, "site-1")).toEqual([]);
  });

  it("catches an assignee without a group", () => {
    const draft = {
      ...applyTemplate(EMPTY_DRAFT, hardware, catalog),
      subject: "x1",
      ownerUserId: "u1",
    };
    expect(draftProblems(draft, "site-1")).toEqual(["Pick an assignee group first"]);
  });
});

describe("toRequestBody", () => {
  it("drops empty optionals and normalizes the ref id", () => {
    const draft = {
      ...applyTemplate(EMPTY_DRAFT, hardware, catalog),
      subject: "  PSU failed ",
      refIncidentNo: "7",
      ccEmails: ["ops@x.io"],
    };
    expect(toRequestBody(draft, "site-1")).toEqual({
      siteId: "site-1",
      templateId: "tpl-hw",
      issueType: "HARDWARE_FAILURE",
      subject: "PSU failed",
      description: "Device:\nSymptom:",
      priority: "P2",
      severity: "MAJOR",
      component: "SERVER",
      subComponent: "SERVER.PSU",
      tool: "VISUAL",
      ownerGroupId: undefined,
      ownerUserId: undefined,
      ccEmails: ["ops@x.io"],
      refIncidentNo: "INC-000007",
    });
  });
});
