import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, Chip, Grid, MenuItem, Stack, TextField, Typography } from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { apiGet } from "../../api/client";
import {
  applyTemplate,
  CC_MAX,
  DESCRIPTION_MAX,
  parseCcList,
  pickTemplateOnTicket,
  SUBJECT_MAX,
  subComponentsFor,
  templateForIssueType,
  type IssueCatalog,
  type ReportDraft,
} from "./issueReporting";

export interface TemplateGroup {
  id: string;
  name: string;
  isDefaultAssignee: boolean | null;
}

interface GroupMember {
  id: string;
  displayName: string;
  email: string;
}

type DraftUpdate = (update: (draft: ReportDraft) => ReportDraft) => void;

/**
 * One row of the template: a bold label cell and the control beside it,
 * laid out like the issue-reporting sheet this form mirrors.
 */
export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" alignItems="flex-start" spacing={1.5}>
      <Typography sx={{ width: 128, flexShrink: 0, fontWeight: 700, fontSize: 14, pt: 1.25 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Stack>
  );
}

/** A stored value no longer offered (retired by an admin) still shows. */
function withCurrent<T extends { value: string; label: string }>(
  options: T[],
  value: string,
): { value: string; label: string }[] {
  return value && !options.some((o) => o.value === value)
    ? [...options, { value, label: `${value} (retired)` }]
    : options;
}

interface IssueTemplateFormProps {
  catalog: IssueCatalog;
  draft: ReportDraft;
  update: DraftUpdate;
  /** "create": the Report an issue page. "edit": a ticket that exists —
   *  the description is frozen and the template only switches issue type. */
  mode: "create" | "edit";
  groups: TemplateGroup[];
  reporter: string;
  /** What goes in the Status row (read-only text, or the staff picker). */
  status: ReactNode;
  /** Extra rows at the top of the left column (e.g. Site). */
  topLeft?: ReactNode;
  /** The Attachments row's content; no row when omitted. */
  attachments?: ReactNode;
  /** Routing fields (Assignee Group, Assignee, Priority) read-only. */
  routingLocked?: boolean;
  routingLockedHint?: string;
  /** Everything read-only (e.g. a closed ticket). */
  locked?: boolean;
  /** Who owns the ticket now, when they aren't in the group's roster. */
  currentOwner?: { id: string; displayName: string } | null;
  priorityHelper?: string;
}

/**
 * The issue reporting template, shared by the client portal's Report an
 * issue page, the client's ticket page and the staff incident page:
 * Template / Subject / Description / Attachments down the left, the
 * classification sheet (Reporter, Assignee Group, Assignee, CC List,
 * Status, Ref Bug ID, Issue Type, Priority, Severity, Component, Sub
 * Component) down the right. Every pick-list comes from the issue catalog
 * the admin maintains; nothing here is hard-coded.
 */
export function IssueTemplateForm({
  catalog,
  draft,
  update,
  mode,
  groups,
  reporter,
  status,
  topLeft,
  attachments,
  routingLocked = false,
  routingLockedHint,
  locked = false,
  currentOwner,
  priorityHelper,
}: IssueTemplateFormProps) {
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [ccInput, setCcInput] = useState("");
  const [ccWarning, setCcWarning] = useState<string | null>(null);

  // Assignee options follow the chosen Assignee Group.
  useEffect(() => {
    if (!draft.ownerGroupId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    apiGet<GroupMember[]>(`/support-groups/${draft.ownerGroupId}/members`)
      .then((res) => !cancelled && setMembers(res))
      .catch(() => !cancelled && setMembers([]));
    return () => {
      cancelled = true;
    };
  }, [draft.ownerGroupId]);

  const subComponents = useMemo(
    () => subComponentsFor(catalog, draft.component),
    [catalog, draft.component],
  );
  const assigneeOptions = useMemo(() => {
    const list = members.map((m) => ({ id: m.id, label: `${m.displayName} (${m.email})` }));
    if (draft.ownerUserId && !list.some((m) => m.id === draft.ownerUserId)) {
      list.push({
        id: draft.ownerUserId,
        label:
          currentOwner?.id === draft.ownerUserId ? currentOwner.displayName : "Current assignee",
      });
    }
    return list;
  }, [members, draft.ownerUserId, currentOwner]);
  const groupOptions = useMemo(
    () =>
      draft.ownerGroupId && !groups.some((g) => g.id === draft.ownerGroupId)
        ? [...groups, { id: draft.ownerGroupId, name: "Current group", isDefaultAssignee: null }]
        : groups,
    [groups, draft.ownerGroupId],
  );

  const set = <K extends keyof ReportDraft>(key: K, value: ReportDraft[K]) =>
    update((d) => ({ ...d, [key]: value }));

  const pickTemplate = (templateId: string) => {
    if (mode === "edit") {
      update((d) => pickTemplateOnTicket(d, templateId, catalog));
      return;
    }
    const template = catalog.templates.find((t) => t.id === templateId) ?? null;
    update((d) => applyTemplate(d, template, catalog));
  };

  // Picking an issue type pulls in its template too (one per issue type),
  // so the two stay in step.
  const pickIssueType = (issueType: string) => {
    const template = templateForIssueType(catalog, issueType);
    if (mode === "edit") {
      update((d) => ({ ...d, issueType, templateId: template?.id ?? "" }));
      return;
    }
    update((d) => ({ ...applyTemplate(d, template, catalog), issueType }));
  };

  const addCc = () => {
    const { emails, invalid } = parseCcList(ccInput);
    let overflow = false;
    update((d) => {
      const merged = [...d.ccEmails];
      for (const e of emails) if (!merged.includes(e)) merged.push(e);
      overflow = merged.length > CC_MAX;
      return { ...d, ccEmails: merged.slice(0, CC_MAX) };
    });
    setCcInput(invalid.join(", "));
    setCcWarning(
      invalid.length > 0
        ? `Not an email address: ${invalid.join(", ")}`
        : overflow
          ? `Only the first ${CC_MAX} addresses were kept`
          : null,
    );
  };

  const selectSx = { "& .MuiInputBase-root": { bgcolor: "background.paper" } };
  const selectedGroup = groupOptions.find((g) => g.id === draft.ownerGroupId);
  const templateOptions = catalog.templates.map((t) => ({ value: t.id, label: t.name }));

  return (
    <Grid container spacing={3}>
      {/* Left: what happened */}
      <Grid item xs={12} md={7}>
        <Stack spacing={2}>
          {topLeft}

          <FieldRow label="Template">
            <TextField
              select
              size="small"
              fullWidth
              value={draft.templateId}
              onChange={(e) => pickTemplate(e.target.value)}
              disabled={locked}
              helperText={
                catalog.templates.length === 0
                  ? "No templates configured yet — pick an issue type on the right"
                  : mode === "create"
                    ? "Fills a draft subject, description and defaults"
                    : "Switching the template changes the issue type"
              }
              sx={selectSx}
            >
              {(mode === "create" || !draft.templateId) && (
                <MenuItem value="" disabled={mode === "edit"}>
                  <em>{mode === "create" ? "No template" : "None (issue type has no template)"}</em>
                </MenuItem>
              )}
              {templateOptions.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  {t.label}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>

          <FieldRow label="Subject">
            <TextField
              size="small"
              fullWidth
              placeholder="e.g. Server in Rack 3 is showing a red fault light"
              value={draft.subject}
              onChange={(e) => set("subject", e.target.value)}
              disabled={locked}
              inputProps={{ maxLength: SUBJECT_MAX }}
              error={draft.subject.length > SUBJECT_MAX}
            />
          </FieldRow>

          <FieldRow label="Description:">
            {mode === "edit" ? (
              <Box>
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    p: 1.5,
                    minHeight: 120,
                    borderRadius: 1,
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: "action.hover",
                    color: draft.description ? "text.primary" : "text.secondary",
                  }}
                >
                  {draft.description || "No description was added."}
                </Typography>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
                  <LockOutlinedIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                  <Typography variant="caption" color="text.secondary">
                    Frozen once the ticket is raised. Add more detail as a message below.
                  </Typography>
                </Stack>
              </Box>
            ) : (
              <TextField
                fullWidth
                multiline
                minRows={14}
                placeholder="Which rack or device, what you can see (lights, alarms, error messages), when it started, what you've already tried"
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
                inputProps={{ maxLength: DESCRIPTION_MAX }}
                helperText={`${draft.description.length} / ${DESCRIPTION_MAX}`}
                sx={{ "& textarea": { fontFamily: "inherit" } }}
              />
            )}
          </FieldRow>

          {attachments && <FieldRow label="Attachments">{attachments}</FieldRow>}
        </Stack>
      </Grid>

      {/* Right: the classification sheet */}
      <Grid item xs={12} md={5}>
        <Stack spacing={1.5}>
          <FieldRow label="Reporter">
            <TextField size="small" fullWidth value={reporter} InputProps={{ readOnly: true }} />
          </FieldRow>

          <FieldRow label="Assignee Group">
            <TextField
              select
              size="small"
              fullWidth
              value={draft.ownerGroupId}
              onChange={(e) =>
                update((d) => ({ ...d, ownerGroupId: e.target.value, ownerUserId: "" }))
              }
              disabled={locked || routingLocked}
              helperText={routingLocked ? routingLockedHint : undefined}
              sx={selectSx}
            >
              {mode === "create" && (
                <MenuItem value="">
                  <em>Let the service desk decide</em>
                </MenuItem>
              )}
              {groupOptions.map((g) => (
                <MenuItem key={g.id} value={g.id}>
                  {g.name}
                  {g.isDefaultAssignee ? " (default)" : ""}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>

          <FieldRow label="Assignee">
            <TextField
              select
              size="small"
              fullWidth
              value={draft.ownerUserId}
              onChange={(e) => set("ownerUserId", e.target.value)}
              disabled={locked || routingLocked || !draft.ownerGroupId}
              helperText={
                !draft.ownerGroupId
                  ? "Pick an assignee group first"
                  : members.length === 0
                    ? `${selectedGroup?.name ?? "This group"} will assign someone`
                    : "Optional — the team usually sets this"
              }
              sx={selectSx}
            >
              <MenuItem value="">
                <em>Unassigned</em>
              </MenuItem>
              {assigneeOptions.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.label}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>

          <FieldRow label="CC List">
            <Box>
              <TextField
                size="small"
                fullWidth
                placeholder="email, email…  then Enter"
                value={ccInput}
                disabled={locked}
                onChange={(e) => setCcInput(e.target.value)}
                onBlur={() => ccInput.trim() && addCc()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addCc();
                  }
                }}
                error={Boolean(ccWarning)}
                helperText={ccWarning ?? "People to copy on updates"}
              />
              {draft.ccEmails.length > 0 && (
                <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                  {draft.ccEmails.map((email) => (
                    <Chip
                      key={email}
                      size="small"
                      label={email}
                      onDelete={
                        locked
                          ? undefined
                          : () =>
                              update((d) => ({
                                ...d,
                                ccEmails: d.ccEmails.filter((e) => e !== email),
                              }))
                      }
                    />
                  ))}
                </Stack>
              )}
            </Box>
          </FieldRow>

          <FieldRow label="Status">{status}</FieldRow>

          <FieldRow label="Ref Bug ID">
            <TextField
              size="small"
              fullWidth
              placeholder="<Bug Number>  e.g. INC-000123"
              value={draft.refIncidentNo}
              onChange={(e) => set("refIncidentNo", e.target.value)}
              disabled={locked}
              helperText="If this duplicates or is blocked by another ticket"
            />
          </FieldRow>

          <FieldRow label="Issue Type">
            <TextField
              select
              size="small"
              fullWidth
              value={draft.issueType}
              onChange={(e) => pickIssueType(e.target.value)}
              disabled={locked}
              sx={selectSx}
            >
              {withCurrent(catalog.issueTypes, draft.issueType).map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>

          <FieldRow label="Priority:">
            <TextField
              select
              size="small"
              fullWidth
              value={draft.priority}
              onChange={(e) => set("priority", e.target.value as ReportDraft["priority"])}
              disabled={locked || routingLocked}
              helperText={
                routingLocked
                  ? routingLockedHint
                  : (priorityHelper ?? "The service desk may adjust this after triage")
              }
              sx={selectSx}
            >
              {mode === "create" && (
                <MenuItem value="">
                  <em>Not sure</em>
                </MenuItem>
              )}
              {catalog.priorities.map((o) => (
                <MenuItem key={o.id} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>

          <FieldRow label="Severity:">
            <TextField
              select
              size="small"
              fullWidth
              value={draft.severity}
              onChange={(e) => set("severity", e.target.value)}
              disabled={locked}
              sx={selectSx}
            >
              <MenuItem value="">
                <em>Not sure</em>
              </MenuItem>
              {withCurrent(catalog.severities, draft.severity).map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>

          <FieldRow label="Component">
            <TextField
              select
              size="small"
              fullWidth
              value={draft.component}
              onChange={(e) =>
                update((d) => ({ ...d, component: e.target.value, subComponent: "" }))
              }
              disabled={locked}
              sx={selectSx}
            >
              <MenuItem value="">
                <em>Not sure</em>
              </MenuItem>
              {withCurrent(catalog.components, draft.component).map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>

          <FieldRow label="Sub Component">
            <TextField
              select
              size="small"
              fullWidth
              value={draft.subComponent}
              onChange={(e) => set("subComponent", e.target.value)}
              disabled={locked || !draft.component}
              helperText={
                !draft.component
                  ? "Pick a component first"
                  : subComponents.length === 0
                    ? "No sub components for this component"
                    : undefined
              }
              sx={selectSx}
            >
              <MenuItem value="">
                <em>Not sure</em>
              </MenuItem>
              {withCurrent(subComponents, draft.subComponent).map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>
        </Stack>
      </Grid>
    </Grid>
  );
}
