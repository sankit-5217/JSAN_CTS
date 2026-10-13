import { describe, expect, it } from "vitest";
import {
  clientGroups,
  draftFromTicket,
  editProblems,
  pickTemplateOnTicket,
  reportEditBody,
  type IssueCatalog,
  type IssueTemplate,
  type TicketFields,
} from "./issueReporting";
import { templateStatusText } from "./issueStatus";

const option = (id: string, value: string, parentId: string | null = null) => ({
  id,
  value,
  label: value,
  parentId,
  sortOrder: 0,
  isActive: true,
});

const template = (id: string, issueTypeId: string, name: string): IssueTemplate => ({
  id,
  issueTypeId,
  name,
  subjectDraft: `[${name}]`,
  descriptionDraft: "What:",
  defaultPriority: null,
  defaultSeverity: null,
  defaultComponent: null,
  defaultSubComponent: null,
  defaultTool: null,
  isActive: true,
});

const catalog: IssueCatalog = {
  issueTypes: [option("it-bug", "BUG"), option("it-chg", "CHANGE_REQUEST")],
  priorities: [option("p3", "P3")],
  severities: [option("s1", "MAJOR")],
  components: [
    { ...option("hw", "HW"), subComponents: [option("hw-s", "HW.SERVER", "hw")] },
    { ...option("sw", "SW"), subComponents: [option("sw-os", "SW.OS", "sw")] },
  ],
  tools: [],
  templates: [
    template("tpl-bug", "it-bug", "Bug"),
    template("tpl-chg", "it-chg", "Change request"),
  ],
  defaultAssigneeGroupId: "grp-desk",
};

const ticket: TicketFields = {
  shortDescription: "Server down",
  description: "It stopped at 2pm",
  issueType: "BUG",
  priority: "P3" as TicketFields["priority"],
  severity: null,
  component: "HW",
  subComponent: "HW.SERVER",
  ownerGroupId: "grp-desk",
  ownerUserId: null,
  ccEmails: ["a@x.io"],
  refIncidentNo: null,
};

describe("editing a raised ticket", () => {
  it("loads the ticket into the template, with the template behind its issue type", () => {
    expect(draftFromTicket(ticket, catalog)).toMatchObject({
      templateId: "tpl-bug",
      issueType: "BUG",
      subject: "Server down",
      description: "It stopped at 2pm",
      component: "HW",
      subComponent: "HW.SERVER",
      ownerGroupId: "grp-desk",
      ccEmails: ["a@x.io"],
    });
  });

  it("sends nothing when nothing changed", () => {
    expect(reportEditBody(ticket, draftFromTicket(ticket, catalog))).toEqual({});
  });

  it("sends only what changed, clears with an empty string, and never the description", () => {
    const draft = {
      ...draftFromTicket(ticket, catalog),
      subject: " Server still down ",
      description: "rewritten",
      component: "SW",
      subComponent: "",
      ccEmails: ["a@x.io", "b@x.io"],
      refIncidentNo: "12",
    };
    expect(reportEditBody(ticket, draft)).toEqual({
      subject: "Server still down",
      component: "SW",
      subComponent: "",
      ccEmails: ["a@x.io", "b@x.io"],
      refIncidentNo: "INC-000012",
    });
  });

  it("switching the template on a ticket only switches the issue type", () => {
    const before = draftFromTicket(ticket, catalog);
    const after = pickTemplateOnTicket(before, "tpl-chg", catalog);
    expect(after).toEqual({ ...before, templateId: "tpl-chg", issueType: "CHANGE_REQUEST" });
  });

  it("flags what blocks saving", () => {
    expect(editProblems({ ...draftFromTicket(ticket, catalog), subject: " " })).toEqual([
      "Give the issue a subject",
    ]);
  });
});

describe("client assignee groups", () => {
  it("keeps the groups clients may pick, plus the default", () => {
    const groups = [
      { id: "1", name: "JSAN ServiceDesk", isDefaultAssignee: true, isClientSelectable: true },
      { id: "2", name: "Infra team", isDefaultAssignee: null, isClientSelectable: true },
      { id: "3", name: "Storage team", isDefaultAssignee: null, isClientSelectable: false },
    ];
    expect(clientGroups(groups).map((g) => g.name)).toEqual(["JSAN ServiceDesk", "Infra team"]);
  });
});

describe("template status labels", () => {
  it("shows the template's words for backend states", () => {
    expect(templateStatusText("ACKNOWLEDGED" as never)).toBe("In Progress");
    expect(templateStatusText("PENDING_VENDOR" as never)).toBe("Pending 3rd Party");
    expect(templateStatusText("PENDING_CUSTOMER" as never)).toBe("Assigned to requester");
    expect(templateStatusText("CLOSED" as never)).toBe("Fixed");
    expect(templateStatusText("BLOCKED" as never, "INC-000009")).toBe("Blocked by INC-000009");
    expect(templateStatusText("DUPLICATE" as never, "INC-000009")).toBe("Duplicate of INC-000009");
  });
});
