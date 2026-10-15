import { Priority } from "@prisma/client";
import { diffReport, idsToName, ReportValues } from "./report-changes";

const base: ReportValues = {
  shortDescription: "UPS on battery",
  issueType: "Bug",
  priority: Priority.P3,
  severity: "Major",
  component: "Hardware",
  subComponent: "UPS",
  ownerGroupId: "g-infra",
  ownerUserId: null,
  refIncidentNo: null,
  ccEmails: [],
};
const names = {
  groups: new Map([
    ["g-infra", "Infra team"],
    ["g-sd", "JSAN ServiceDesk"],
  ]),
  users: new Map([["u-1", "Rahul"]]),
};

describe("diffReport (rubric T3/T4)", () => {
  it("lists each changed field old → new, ids as names, in template order", () => {
    const changes = diffReport(
      base,
      {
        ...base,
        priority: Priority.P2,
        ownerGroupId: "g-sd",
        ownerUserId: "u-1",
        ccEmails: ["a@x.com"],
      },
      names,
    );
    expect(changes).toEqual([
      { field: "priority", label: "Priority", from: "P3", to: "P2" },
      {
        field: "ownerGroupId",
        label: "Assignee group",
        from: "Infra team",
        to: "JSAN ServiceDesk",
      },
      { field: "ownerUserId", label: "Assignee", from: null, to: "Rahul" },
      { field: "ccEmails", label: "CC", from: null, to: "a@x.com" },
    ]);
  });

  it("reports nothing when nothing changed (empty/null/[] are the same)", () => {
    expect(diffReport(base, { ...base, ccEmails: [], refIncidentNo: null }, names)).toEqual([]);
    expect(diffReport({ ...base, severity: "" }, { ...base, severity: null }, names)).toEqual([]);
  });

  it("clearing a field shows 'none' as the new value (null)", () => {
    expect(diffReport(base, { ...base, subComponent: null }, names)).toEqual([
      { field: "subComponent", label: "Sub component", from: "UPS", to: null },
    ]);
  });

  it("never leaks an id when a name is unknown", () => {
    const [change] = diffReport(base, { ...base, ownerGroupId: "g-gone" }, names);
    expect(change.to).toBe("a support group");
  });

  it("collects the ids that need names", () => {
    expect(idsToName(base, { ...base, ownerGroupId: "g-sd", ownerUserId: "u-1" })).toEqual({
      groupIds: ["g-infra", "g-sd"],
      userIds: ["u-1"],
    });
  });
});
