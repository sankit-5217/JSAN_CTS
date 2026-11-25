import { Incident } from "@prisma/client";

/** One field of a report edit, as people read it: "Priority: P3 → P2". */
export interface ReportChange {
  field: ReportField;
  label: string;
  /** Readable old/new value (group and user names, not ids); null = was/is empty. */
  from: string | null;
  to: string | null;
}

type ReportField =
  | "shortDescription"
  | "issueType"
  | "priority"
  | "severity"
  | "component"
  | "subComponent"
  | "ownerGroupId"
  | "ownerUserId"
  | "refIncidentNo"
  | "ccEmails";

/** The issue-template fields a reporter can edit, in the order the template shows them. */
export const REPORT_FIELDS: { field: ReportField; label: string }[] = [
  { field: "shortDescription", label: "Subject" },
  { field: "issueType", label: "Issue type" },
  { field: "priority", label: "Priority" },
  { field: "severity", label: "Severity" },
  { field: "component", label: "Component" },
  { field: "subComponent", label: "Sub component" },
  { field: "ownerGroupId", label: "Assignee group" },
  { field: "ownerUserId", label: "Assignee" },
  { field: "refIncidentNo", label: "Ref bug ID" },
  { field: "ccEmails", label: "CC" },
];

export type ReportValues = Pick<Incident, ReportField>;

/** Names for the id-valued fields. */
export interface ReportNames {
  groups: Map<string, string>;
  users: Map<string, string>;
}

function readable(field: ReportField, value: unknown, names: ReportNames): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : null;
  if (field === "ownerGroupId") return names.groups.get(String(value)) ?? "a support group";
  if (field === "ownerUserId") return names.users.get(String(value)) ?? "an engineer";
  return String(value);
}

/**
 * What changed between two versions of a report, field by field, with ids
 * resolved to names. Pure: the caller loads the names. Used for the
 * REPORT_EDITED timeline entry that both the client and the service desk
 * see in the ticket's conversation.
 */
export function diffReport(
  before: ReportValues,
  after: ReportValues,
  names: ReportNames,
): ReportChange[] {
  const changes: ReportChange[] = [];
  for (const { field, label } of REPORT_FIELDS) {
    const from = readable(field, before[field], names);
    const to = readable(field, after[field], names);
    if (from !== to) changes.push({ field, label, from, to });
  }
  return changes;
}

/** The group and user ids a diff needs names for. */
export function idsToName(before: ReportValues, after: ReportValues) {
  return {
    groupIds: [before.ownerGroupId, after.ownerGroupId].filter((v): v is string => !!v),
    userIds: [before.ownerUserId, after.ownerUserId].filter((v): v is string => !!v),
  };
}
