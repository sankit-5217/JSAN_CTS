import type { Priority } from "@cts-dc-opsdesk/shared-types";

/** GET /issue-reporting/catalog (IssueReportingService.getCatalog). */
export interface CatalogOption {
  id: string;
  value: string;
  label: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface CatalogComponent extends CatalogOption {
  subComponents: CatalogOption[];
}

export interface IssueTemplate {
  id: string;
  issueTypeId: string;
  name: string;
  subjectDraft: string | null;
  descriptionDraft: string;
  defaultPriority: Priority | null;
  defaultSeverity: string | null;
  defaultComponent: string | null;
  defaultSubComponent: string | null;
  defaultTool: string | null;
  isActive: boolean;
}

export interface IssueCatalog {
  issueTypes: CatalogOption[];
  priorities: CatalogOption[];
  severities: CatalogOption[];
  components: CatalogComponent[];
  tools: CatalogOption[];
  templates: IssueTemplate[];
  defaultAssigneeGroupId: string | null;
}

/** What the form holds; maps 1:1 onto POST /incidents/customer-report. */
export interface ReportDraft {
  templateId: string;
  issueType: string;
  subject: string;
  description: string;
  priority: Priority | "";
  severity: string;
  component: string;
  subComponent: string;
  ownerGroupId: string;
  ownerUserId: string;
  ccEmails: string[];
  refIncidentNo: string;
}

export const EMPTY_DRAFT: ReportDraft = {
  templateId: "",
  issueType: "",
  subject: "",
  description: "",
  priority: "",
  severity: "",
  component: "",
  subComponent: "",
  ownerGroupId: "",
  ownerUserId: "",
  ccEmails: [],
  refIncidentNo: "",
};

export const SUBJECT_MAX = 256;
export const DESCRIPTION_MAX = 8000;
export const CC_MAX = 20;

export function labelFor(
  options: { value: string; label: string }[],
  value: string | null | undefined,
): string {
  if (!value) return "";
  return options.find((o) => o.value === value)?.label ?? value;
}

export function subComponentsFor(catalog: IssueCatalog, component: string): CatalogOption[] {
  return catalog.components.find((c) => c.value === component)?.subComponents ?? [];
}

/** Every sub component across components, for labelling a stored value. */
export function allSubComponents(catalog: IssueCatalog): CatalogOption[] {
  return catalog.components.flatMap((c) => c.subComponents);
}

/**
 * Picking a template ("Auto Draft/Field selection") sets the issue type and
 * the defaults, and drops the subject/description drafts in — but only over
 * text the reporter hasn't written themselves: an empty field, or one still
 * holding the previous template's draft. Hand-typed text is never replaced.
 */
export function applyTemplate(
  draft: ReportDraft,
  template: IssueTemplate | null,
  catalog: IssueCatalog,
): ReportDraft {
  const previous = catalog.templates.find((t) => t.id === draft.templateId) ?? null;
  const untouched = (current: string, previousDraft: string | null | undefined) =>
    current.trim() === "" || current === (previousDraft ?? "");
  if (!template) {
    return {
      ...draft,
      templateId: "",
      subject: untouched(draft.subject, previous?.subjectDraft) ? "" : draft.subject,
      description: untouched(draft.description, previous?.descriptionDraft)
        ? ""
        : draft.description,
    };
  }
  const issueType = catalog.issueTypes.find((t) => t.id === template.issueTypeId)?.value ?? "";
  const component = template.defaultComponent ?? "";
  const subComponent = template.defaultSubComponent ?? "";
  return {
    ...draft,
    templateId: template.id,
    issueType,
    subject: untouched(draft.subject, previous?.subjectDraft)
      ? (template.subjectDraft ?? "")
      : draft.subject,
    description: untouched(draft.description, previous?.descriptionDraft)
      ? template.descriptionDraft
      : draft.description,
    priority: template.defaultPriority ?? draft.priority,
    severity: template.defaultSeverity ?? draft.severity,
    component,
    subComponent: subComponentsFor(catalog, component).some((s) => s.value === subComponent)
      ? subComponent
      : "",
  };
}

/**
 * The template picker on a ticket that already exists: it switches the
 * issue type (one template per type) and nothing else — the subject and
 * classification are already the reporter's own, and the description is
 * frozen.
 */
export function pickTemplateOnTicket(
  draft: ReportDraft,
  templateId: string,
  catalog: IssueCatalog,
): ReportDraft {
  const template = catalog.templates.find((t) => t.id === templateId);
  const issueType = template
    ? (catalog.issueTypes.find((t) => t.id === template.issueTypeId)?.value ?? draft.issueType)
    : draft.issueType;
  return { ...draft, templateId, issueType };
}

/** The template that drafts a given issue type, if one is configured. */
export function templateForIssueType(
  catalog: IssueCatalog,
  issueType: string,
): IssueTemplate | null {
  const option = catalog.issueTypes.find((t) => t.value === issueType);
  return option ? (catalog.templates.find((t) => t.issueTypeId === option.id) ?? null) : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Splits a pasted CC list on commas, semicolons, whitespace and newlines. */
export function parseCcList(text: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const token = raw.trim().replace(/^<|>$/g, "");
    if (!token) continue;
    const email = token.toLowerCase();
    if (!EMAIL.test(email)) {
      invalid.push(token);
    } else if (!emails.includes(email)) {
      emails.push(email);
    }
  }
  return { emails, invalid };
}

/** "123" or "inc-000123" -> "INC-000123"; anything else is returned trimmed. */
export function normalizeRefIncidentNo(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (/^\d+$/.test(trimmed)) return `INC-${trimmed.padStart(6, "0")}`;
  return trimmed;
}

/** Why the form can't be submitted yet, in the order the fields appear. */
export function draftProblems(draft: ReportDraft, siteId: string): string[] {
  const problems: string[] = [];
  if (!siteId) problems.push("Pick the site the issue is at");
  if (!draft.issueType) problems.push("Pick an issue type (or a template)");
  if (draft.subject.trim().length < 2) problems.push("Give the issue a subject");
  if (draft.subject.length > SUBJECT_MAX)
    problems.push(`Subject is over ${SUBJECT_MAX} characters`);
  if (draft.description.length > DESCRIPTION_MAX)
    problems.push(`Description is over ${DESCRIPTION_MAX} characters`);
  if (draft.subComponent && !draft.component) problems.push("A sub component needs its component");
  if (draft.ownerUserId && !draft.ownerGroupId) problems.push("Pick an assignee group first");
  if (draft.ccEmails.length > CC_MAX) problems.push(`CC list can hold at most ${CC_MAX} addresses`);
  return problems;
}

/** The request body for POST /incidents/customer-report. */
export function toRequestBody(draft: ReportDraft, siteId: string) {
  const opt = (v: string) => (v.trim() === "" ? undefined : v.trim());
  return {
    siteId,
    templateId: opt(draft.templateId),
    issueType: draft.issueType,
    subject: draft.subject.trim(),
    description: opt(draft.description),
    priority: draft.priority || undefined,
    severity: opt(draft.severity),
    component: opt(draft.component),
    subComponent: opt(draft.subComponent),
    ownerGroupId: opt(draft.ownerGroupId),
    ownerUserId: opt(draft.ownerUserId),
    ccEmails: draft.ccEmails.length > 0 ? draft.ccEmails : undefined,
    refIncidentNo: draft.refIncidentNo.trim()
      ? normalizeRefIncidentNo(draft.refIncidentNo)
      : undefined,
  };
}

/** The template fields of an incident as GET /incidents/:id returns them. */
export interface TicketFields {
  shortDescription: string;
  description: string | null;
  issueType: string | null;
  priority: Priority;
  severity: string | null;
  component: string | null;
  subComponent: string | null;
  ownerGroupId: string | null;
  ownerUserId: string | null;
  ccEmails: string[];
  refIncidentNo: string | null;
}

/** An existing ticket loaded into the template form. */
export function draftFromTicket(ticket: TicketFields, catalog: IssueCatalog | null): ReportDraft {
  const template =
    catalog && ticket.issueType ? templateForIssueType(catalog, ticket.issueType) : null;
  return {
    templateId: template?.id ?? "",
    issueType: ticket.issueType ?? "",
    subject: ticket.shortDescription,
    description: ticket.description ?? "",
    priority: ticket.priority,
    severity: ticket.severity ?? "",
    component: ticket.component ?? "",
    subComponent: ticket.subComponent ?? "",
    ownerGroupId: ticket.ownerGroupId ?? "",
    ownerUserId: ticket.ownerUserId ?? "",
    ccEmails: [...(ticket.ccEmails ?? [])],
    refIncidentNo: ticket.refIncidentNo ?? "",
  };
}

/** Why an edited ticket can't be saved yet. */
export function editProblems(draft: ReportDraft): string[] {
  const problems: string[] = [];
  if (!draft.issueType) problems.push("Pick an issue type (or a template)");
  if (draft.subject.trim().length < 2) problems.push("Give the issue a subject");
  if (draft.subject.length > SUBJECT_MAX)
    problems.push(`Subject is over ${SUBJECT_MAX} characters`);
  if (draft.subComponent && !draft.component) problems.push("A sub component needs its component");
  if (draft.ownerUserId && !draft.ownerGroupId) problems.push("Pick an assignee group first");
  if (draft.ccEmails.length > CC_MAX) problems.push(`CC list can hold at most ${CC_MAX} addresses`);
  return problems;
}

/**
 * Only what changed, as PATCH /incidents/:id/report expects it ("" clears
 * an optional field). Description and status are never sent: the first is
 * frozen, the second is staff-only.
 */
export function reportEditBody(ticket: TicketFields, draft: ReportDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const changed = (a: string | null | undefined, b: string) => (a ?? "") !== b;
  if (changed(ticket.issueType, draft.issueType)) body.issueType = draft.issueType;
  if (ticket.shortDescription !== draft.subject.trim()) body.subject = draft.subject.trim();
  if (draft.priority && ticket.priority !== draft.priority) body.priority = draft.priority;
  if (changed(ticket.severity, draft.severity)) body.severity = draft.severity;
  if (changed(ticket.component, draft.component)) body.component = draft.component;
  if (changed(ticket.subComponent, draft.subComponent)) body.subComponent = draft.subComponent;
  if (draft.ownerGroupId && changed(ticket.ownerGroupId, draft.ownerGroupId))
    body.ownerGroupId = draft.ownerGroupId;
  if (changed(ticket.ownerUserId, draft.ownerUserId)) body.ownerUserId = draft.ownerUserId;
  const cc = ticket.ccEmails ?? [];
  if (cc.length !== draft.ccEmails.length || cc.some((e, i) => e !== draft.ccEmails[i]))
    body.ccEmails = draft.ccEmails;
  const ref = draft.refIncidentNo.trim() ? normalizeRefIncidentNo(draft.refIncidentNo) : "";
  if (changed(ticket.refIncidentNo, ref)) body.refIncidentNo = ref;
  return body;
}

/** The Assignee Groups a client may pick (the backend enforces the same). */
export function clientGroups<
  T extends { isClientSelectable?: boolean; isDefaultAssignee: boolean | null },
>(groups: T[]): T[] {
  return groups.filter((g) => g.isClientSelectable || g.isDefaultAssignee);
}
