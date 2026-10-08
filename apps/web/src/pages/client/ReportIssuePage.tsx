import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import { apiGet, apiPost, apiUpload, getStoredToken } from "../../api/client";
import { decodeJwtPayload } from "../../api/jwt";
import {
  applyTemplate,
  CC_MAX,
  DESCRIPTION_MAX,
  draftProblems,
  EMPTY_DRAFT,
  parseCcList,
  SUBJECT_MAX,
  subComponentsFor,
  templateForIssueType,
  toRequestBody,
  type IssueCatalog,
  type ReportDraft,
} from "./issueReporting";

interface Site {
  id: string;
  code: string;
  name: string;
}

interface SupportGroup {
  id: string;
  name: string;
  isDefaultAssignee: boolean | null;
}

interface GroupMember {
  id: string;
  displayName: string;
  email: string;
}

interface CreatedIncident {
  id: string;
}

/**
 * One row of the template: a bold label cell and the control beside it,
 * laid out like the issue-reporting sheet this page mirrors.
 */
function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" alignItems="flex-start" spacing={1.5}>
      <Typography sx={{ width: 128, flexShrink: 0, fontWeight: 700, fontSize: 14, pt: 1.25 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Stack>
  );
}

/**
 * The client portal's "Report an issue" page, laid out as the issue
 * reporting template: Template / Subject / Description / Attachments down
 * the left, the classification sheet (Reporter, Assignee Group, Assignee,
 * CC List, Status, Ref Bug ID, Issue Type, Priority, Severity, Component,
 * Sub Component, Tool) down the right. Every pick-list comes from the
 * issue catalog the admin maintains; nothing here is hard-coded.
 *
 * Status is shown, not picked: a new report is always "New" (the backend
 * state machine owns status). Reporter is the signed-in account.
 */
export function ReportIssuePage() {
  const navigate = useNavigate();
  const token = getStoredToken();
  const reporterEmail = token ? (decodeJwtPayload(token)?.email ?? "") : "";

  const [catalog, setCatalog] = useState<IssueCatalog | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [groups, setGroups] = useState<SupportGroup[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [siteId, setSiteId] = useState("");
  const [draft, setDraft] = useState<ReportDraft>(EMPTY_DRAFT);
  const [ccInput, setCcInput] = useState("");
  const [ccWarning, setCcWarning] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      apiGet<IssueCatalog>("/issue-reporting/catalog"),
      apiGet<{ items: Site[] } | Site[]>("/sites"),
      apiGet<SupportGroup[]>("/support-groups"),
    ])
      .then(([cat, siteRes, groupRes]) => {
        const items = Array.isArray(siteRes) ? siteRes : siteRes.items;
        setCatalog(cat);
        setSites(items);
        setGroups(groupRes);
        if (items.length === 1) setSiteId(items[0].id);
        // "Service Desk is default": pre-select the flagged group.
        setDraft((d) => ({ ...d, ownerGroupId: cat.defaultAssigneeGroupId ?? "" }));
      })
      .catch((err: Error) => setLoadError(err.message));
  }, []);

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
    () => (catalog ? subComponentsFor(catalog, draft.component) : []),
    [catalog, draft.component],
  );

  const set = <K extends keyof ReportDraft>(key: K, value: ReportDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const pickTemplate = (templateId: string) => {
    if (!catalog) return;
    const template = catalog.templates.find((t) => t.id === templateId) ?? null;
    setDraft((d) => applyTemplate(d, template, catalog));
  };

  // Picking an issue type directly pulls in its template too ("we will
  // have one for each issue type"), so the drafts stay in step.
  const pickIssueType = (issueType: string) => {
    if (!catalog) return;
    const template = templateForIssueType(catalog, issueType);
    setDraft((d) => ({ ...applyTemplate(d, template, catalog), issueType }));
  };

  const addCc = () => {
    const { emails, invalid } = parseCcList(ccInput);
    const merged = [...draft.ccEmails];
    for (const e of emails) if (!merged.includes(e)) merged.push(e);
    set("ccEmails", merged.slice(0, CC_MAX));
    setCcInput(invalid.join(", "));
    setCcWarning(
      invalid.length > 0
        ? `Not an email address: ${invalid.join(", ")}`
        : merged.length > CC_MAX
          ? `Only the first ${CC_MAX} addresses were kept`
          : null,
    );
  };

  const problems = draftProblems(draft, siteId);
  const canSubmit = problems.length === 0 && !submitting && catalog !== null;

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    let incident: CreatedIncident;
    try {
      incident = await apiPost<CreatedIncident>(
        "/incidents/customer-report",
        toRequestBody(draft, siteId),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
      return;
    }
    // The ticket exists now; a failed upload shouldn't lose it. The ticket
    // page lets them attach again.
    const failedUploads: string[] = [];
    for (const file of files) {
      try {
        await apiUpload(`/incidents/${incident.id}/attachments`, file);
      } catch {
        failedUploads.push(file.name);
      }
    }
    navigate(`/client/tickets/${incident.id}`, { state: { justCreated: true, failedUploads } });
  };

  if (loadError) {
    return <Alert severity="error">Could not load the report form: {loadError}</Alert>;
  }
  if (!catalog) {
    return <Typography color="text.secondary">Loading the report form...</Typography>;
  }

  const selectSx = { "& .MuiInputBase-root": { bgcolor: "background.paper" } };
  const noTemplates = catalog.templates.length === 0;
  const selectedGroup = groups.find((g) => g.id === draft.ownerGroupId);

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        Report an issue
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Pick a template to start from a draft, fill in what you can, and attach any logs,
        screenshots or videos. The service desk picks it up from there.
      </Typography>

      <Card elevation={0} sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Grid container spacing={3}>
            {/* Left: what happened */}
            <Grid item xs={12} md={7}>
              <Stack spacing={2}>
                <FieldRow label="Site">
                  {sites.length > 1 ? (
                    <TextField
                      select
                      size="small"
                      fullWidth
                      value={siteId}
                      onChange={(e) => setSiteId(e.target.value)}
                      sx={selectSx}
                    >
                      {sites.map((s) => (
                        <MenuItem key={s.id} value={s.id}>
                          {s.code} — {s.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    <Typography sx={{ pt: 1.25 }}>
                      {sites[0] ? `${sites[0].code} — ${sites[0].name}` : "No site assigned"}
                    </Typography>
                  )}
                </FieldRow>

                <FieldRow label="Template">
                  <TextField
                    select
                    size="small"
                    fullWidth
                    value={draft.templateId}
                    onChange={(e) => pickTemplate(e.target.value)}
                    helperText={
                      noTemplates
                        ? "No templates configured yet — pick an issue type on the right"
                        : "One per issue type: fills a draft subject, description and defaults"
                    }
                    sx={selectSx}
                  >
                    <MenuItem value="">
                      <em>No template</em>
                    </MenuItem>
                    {catalog.templates.map((t) => (
                      <MenuItem key={t.id} value={t.id}>
                        {t.name}
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
                    inputProps={{ maxLength: SUBJECT_MAX }}
                    error={draft.subject.length > SUBJECT_MAX}
                  />
                </FieldRow>

                <FieldRow label="Description:">
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
                </FieldRow>

                <FieldRow label="Attachments">
                  <Box>
                    <Button
                      component="label"
                      variant="outlined"
                      size="small"
                      startIcon={<AttachFileOutlinedIcon />}
                      sx={{ textTransform: "none" }}
                    >
                      log file / screenshots / videos
                      <input
                        type="file"
                        hidden
                        multiple
                        onChange={(e) => {
                          const picked = Array.from(e.target.files ?? []);
                          setFiles((prev) => [...prev, ...picked]);
                          e.target.value = "";
                        }}
                      />
                    </Button>
                    {files.length > 0 && (
                      <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                        {files.map((f, i) => (
                          <Chip
                            key={`${f.name}-${i}`}
                            size="small"
                            label={`${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`}
                            onDelete={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                          />
                        ))}
                      </Stack>
                    )}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 0.5 }}
                    >
                      Up to 100 MB each. Stored securely with the ticket; only people on the ticket
                      can open them.
                    </Typography>
                  </Box>
                </FieldRow>
              </Stack>
            </Grid>

            {/* Right: the classification sheet */}
            <Grid item xs={12} md={5}>
              <Stack spacing={1.5}>
                <FieldRow label="Reporter">
                  <TextField
                    size="small"
                    fullWidth
                    value={reporterEmail}
                    InputProps={{ readOnly: true }}
                    helperText="From your sign-in"
                  />
                </FieldRow>

                <FieldRow label="Assignee Group">
                  <TextField
                    select
                    size="small"
                    fullWidth
                    value={draft.ownerGroupId}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, ownerGroupId: e.target.value, ownerUserId: "" }))
                    }
                    sx={selectSx}
                  >
                    <MenuItem value="">
                      <em>Let the service desk decide</em>
                    </MenuItem>
                    {groups.map((g) => (
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
                    disabled={!draft.ownerGroupId}
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
                    {members.map((m) => (
                      <MenuItem key={m.id} value={m.id}>
                        {m.displayName} ({m.email})
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
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ mt: 0.5 }}
                        flexWrap="wrap"
                        useFlexGap
                      >
                        {draft.ccEmails.map((email) => (
                          <Chip
                            key={email}
                            size="small"
                            label={email}
                            onDelete={() =>
                              set(
                                "ccEmails",
                                draft.ccEmails.filter((e) => e !== email),
                              )
                            }
                          />
                        ))}
                      </Stack>
                    )}
                  </Box>
                </FieldRow>

                <FieldRow label="Status">
                  <TextField
                    size="small"
                    fullWidth
                    value="New"
                    InputProps={{ readOnly: true }}
                    helperText="Set by the service desk as work progresses"
                  />
                </FieldRow>

                <FieldRow label="Ref Bug ID">
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="<Bug Number>  e.g. INC-000123"
                    value={draft.refIncidentNo}
                    onChange={(e) => set("refIncidentNo", e.target.value)}
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
                    sx={selectSx}
                  >
                    {catalog.issueTypes.map((o) => (
                      <MenuItem key={o.id} value={o.value}>
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
                    helperText="The service desk may adjust this after triage"
                    sx={selectSx}
                  >
                    <MenuItem value="">
                      <em>Not sure</em>
                    </MenuItem>
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
                    sx={selectSx}
                  >
                    <MenuItem value="">
                      <em>Not sure</em>
                    </MenuItem>
                    {catalog.severities.map((o) => (
                      <MenuItem key={o.id} value={o.value}>
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
                      setDraft((d) => ({ ...d, component: e.target.value, subComponent: "" }))
                    }
                    sx={selectSx}
                  >
                    <MenuItem value="">
                      <em>Not sure</em>
                    </MenuItem>
                    {catalog.components.map((o) => (
                      <MenuItem key={o.id} value={o.value}>
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
                    disabled={!draft.component || subComponents.length === 0}
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
                    {subComponents.map((o) => (
                      <MenuItem key={o.id} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </TextField>
                </FieldRow>

                <FieldRow label="Tool">
                  <TextField
                    select
                    size="small"
                    fullWidth
                    value={draft.tool}
                    onChange={(e) => set("tool", e.target.value)}
                    helperText="Where you saw the problem"
                    sx={selectSx}
                  >
                    <MenuItem value="">
                      <em>Not sure</em>
                    </MenuItem>
                    {catalog.tools.map((o) => (
                      <MenuItem key={o.id} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </TextField>
                </FieldRow>
              </Stack>
            </Grid>
          </Grid>

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems={{ sm: "center" }}
            sx={{ mt: 3 }}
          >
            <Button
              variant="contained"
              size="large"
              disabled={!canSubmit}
              onClick={handleSubmit}
              sx={{ textTransform: "none", fontWeight: 600, px: 4 }}
            >
              {submitting
                ? files.length > 0
                  ? "Submitting and uploading..."
                  : "Submitting..."
                : "Submit"}
            </Button>
            {problems.length > 0 && !submitting && (
              <Typography variant="body2" color="text.secondary">
                {problems[0]}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
