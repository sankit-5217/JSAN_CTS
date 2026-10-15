import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { IssueTemplateForm } from "./IssueTemplateForm";
import { draftFromTicket, type IssueCatalog, type TicketFields } from "./issueReporting";

const option = (id: string, value: string, parentId: string | null = null) => ({
  id,
  value,
  label: value,
  parentId,
  sortOrder: 0,
  isActive: true,
});

const catalog: IssueCatalog = {
  issueTypes: [option("it-bug", "BUG")],
  priorities: [option("p3", "P3")],
  severities: [],
  components: [{ ...option("hw", "HW"), subComponents: [] }],
  tools: [],
  templates: [
    {
      id: "tpl-bug",
      issueTypeId: "it-bug",
      name: "Bug",
      subjectDraft: "[Bug]",
      descriptionDraft: "What:",
      defaultPriority: null,
      defaultSeverity: null,
      defaultComponent: null,
      defaultSubComponent: null,
      defaultTool: null,
      isActive: true,
    },
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
  subComponent: null,
  ownerGroupId: "grp-desk",
  ownerUserId: null,
  ccEmails: [],
  refIncidentNo: null,
};

const render = (props: { mode: "create" | "edit"; hideTemplate?: boolean }) =>
  renderToStaticMarkup(
    <IssueTemplateForm
      catalog={catalog}
      draft={draftFromTicket(ticket, catalog)}
      update={() => undefined}
      groups={[{ id: "grp-desk", name: "JSAN ServiceDesk", members: [] } as never]}
      reporter="client@example.com"
      status={<span>New</span>}
      {...props}
    />,
  );

/** The bold label cells of the template ("Template", "Subject", ...). */
const labels = (html: string) =>
  [...html.matchAll(/>(Template|Subject|Issue Type|Priority:|Assignee Group)</g)].map((m) => m[1]);

describe("rubric T1: no Template button on the client's ticket page once the report exists", () => {
  it("the ticket page (edit, hideTemplate) has no Template row, but keeps every other field", () => {
    const html = render({ mode: "edit", hideTemplate: true });
    expect(labels(html)).not.toContain("Template");
    expect(labels(html)).toEqual(
      expect.arrayContaining(["Subject", "Issue Type", "Priority:", "Assignee Group"]),
    );
  });

  it("Report an issue (create) still offers templates", () => {
    expect(labels(render({ mode: "create" }))).toContain("Template");
  });
});
