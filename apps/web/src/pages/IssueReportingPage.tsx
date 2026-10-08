import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";

// Mirrors ISSUE_REPORTING_ADMIN_ROLES / ISSUE_REPORTING_VIEW_ROLES on the
// backend — UI-only gate; the API re-checks regardless. Admins edit, the
// service desk reads, nobody else (engineers included) opens the page.
const ADMIN_ROLES = ["SUPER_ADMIN", "DELIVERY_OPS_MANAGER"];
const VIEW_ROLES = [...ADMIN_ROLES, "SERVICE_DESK_NOC"];

type Kind = "ISSUE_TYPE" | "PRIORITY" | "SEVERITY" | "COMPONENT" | "SUB_COMPONENT" | "TOOL";

const KINDS: { kind: Kind; label: string; hint: string }[] = [
  { kind: "ISSUE_TYPE", label: "Issue type", hint: "One template can be drafted per issue type." },
  {
    kind: "PRIORITY",
    label: "Priority",
    hint: "Re-labels the fixed P1-P4 priorities the SLA policies key on.",
  },
  { kind: "SEVERITY", label: "Severity", hint: "How bad it is, in the reporter's words." },
  { kind: "COMPONENT", label: "Component", hint: "The part of the estate affected." },
  {
    kind: "SUB_COMPONENT",
    label: "Sub component",
    hint: "Shown on the form once its component is picked.",
  },
  { kind: "TOOL", label: "Tool", hint: "Where the reporter noticed the problem." },
];

interface CatalogOption {
  id: string;
  kind: Kind;
  value: string;
  label: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
}

interface Template {
  id: string;
  issueTypeId: string;
  name: string;
  subjectDraft: string | null;
  descriptionDraft: string;
  defaultPriority: string | null;
  defaultSeverity: string | null;
  defaultComponent: string | null;
  defaultSubComponent: string | null;
  defaultTool: string | null;
  isActive: boolean;
}

interface SupportGroup {
  id: string;
  name: string;
  isDefaultAssignee: boolean | null;
}

const VALUE_PATTERN = /^[A-Z0-9][A-Z0-9_.-]{0,63}$/;

/**
 * Admin page behind the client portal's "Report an issue" form: the
 * pick-lists (the "Issue Reporting UI" dropdowns), the per-issue-type
 * templates, and which support group new reports land in. Everything here
 * is DB configuration the form reads live — nothing is hard-coded.
 */
export function IssueReportingPage() {
  const role = getCurrentUserRole() ?? "";
  const canWrite = ADMIN_ROLES.includes(role);
  const canView = VIEW_ROLES.includes(role);
  const [options, setOptions] = useState<CatalogOption[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [groups, setGroups] = useState<SupportGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("ISSUE_TYPE");

  const reload = useCallback(() => {
    setError(null);
    Promise.all([
      apiGet<CatalogOption[]>("/issue-reporting/options?includeInactive=1"),
      apiGet<Template[]>("/issue-reporting/templates?includeInactive=1"),
      apiGet<SupportGroup[]>("/support-groups"),
    ])
      .then(([opts, tpls, grps]) => {
        setOptions(opts);
        setTemplates(tpls);
        setGroups(grps);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setActionError(null);
    setNotice(null);
    try {
      await work();
      setNotice(done);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const byKind = (k: Kind) =>
    options
      .filter((o) => o.kind === k)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  const components = useMemo(() => byKind("COMPONENT"), [options]); // eslint-disable-line react-hooks/exhaustive-deps
  const defaultGroup = groups.find((g) => g.isDefaultAssignee) ?? null;

  // After the hooks above (rules of hooks): anyone outside the view roles
  // is sent back to the Command Center instead of seeing the configuration.
  if (!canView) {
    return <Navigate to="/" replace />;
  }

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 1 }}>
        Issue reporting
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        What a client sees on "Report an issue": the dropdown values, the template drafted for each
        issue type, and the group new reports are assigned to. Retire a value rather than deleting
        it — existing tickets keep referring to it.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load the issue-reporting configuration: {error}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {!canWrite && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Read-only: changes here need a Super Admin or Delivery Ops Manager.
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Default assignee group
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          The "Assignee Group" a new client report lands in unless the reporter picks another (the
          template's "Service Desk is default"). Members are managed under Support groups.
        </Typography>
        <DefaultGroupPicker
          groups={groups}
          current={defaultGroup}
          canWrite={canWrite}
          onSave={(id) =>
            run(() => apiPost(`/support-groups/${id}/default`), "Default assignee group updated")
          }
        />
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Dropdown values
        </Typography>
        <Tabs
          value={kind}
          onChange={(_, v: Kind) => setKind(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 2 }}
        >
          {KINDS.map((k) => (
            <Tab key={k.kind} value={k.kind} label={k.label} />
          ))}
        </Tabs>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {KINDS.find((k) => k.kind === kind)?.hint}
        </Typography>

        <Stack spacing={1} sx={{ mb: 2 }}>
          {byKind(kind).map((o) => (
            <OptionRow
              key={o.id}
              option={o}
              parentLabel={
                o.parentId ? (components.find((c) => c.id === o.parentId)?.label ?? "?") : null
              }
              canWrite={canWrite}
              onSave={(patch) =>
                run(() => apiPatch(`/issue-reporting/options/${o.id}`, patch), `Saved ${o.label}`)
              }
            />
          ))}
          {byKind(kind).length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No values yet — the form shows this dropdown empty until one is added.
            </Typography>
          )}
        </Stack>

        {canWrite && (
          <NewOptionForm
            kind={kind}
            components={components}
            onCreate={(body) =>
              run(() => apiPost("/issue-reporting/options", body), `Added ${body.label}`)
            }
          />
        )}
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Templates (one per issue type)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Picking a template on the form fills a draft subject and description plus default
          priority, severity, component and tool — all of which the reporter can still change.
        </Typography>
        <Stack spacing={2}>
          {byKind("ISSUE_TYPE").map((issueType) => (
            <TemplateEditor
              key={issueType.id}
              issueType={issueType}
              template={templates.find((t) => t.issueTypeId === issueType.id) ?? null}
              options={options}
              canWrite={canWrite}
              onSave={(body, existing) =>
                run(
                  () =>
                    existing
                      ? apiPatch(`/issue-reporting/templates/${existing.id}`, body)
                      : apiPost("/issue-reporting/templates", {
                          ...body,
                          issueTypeId: issueType.id,
                        }),
                  `Template for ${issueType.label} saved`,
                )
              }
            />
          ))}
        </Stack>
      </Paper>
    </Box>
  );
}

function DefaultGroupPicker({
  groups,
  current,
  canWrite,
  onSave,
}: {
  groups: SupportGroup[];
  current: SupportGroup | null;
  canWrite: boolean;
  onSave: (groupId: string) => Promise<void>;
}) {
  const [picked, setPicked] = useState("");
  useEffect(() => setPicked(current?.id ?? ""), [current?.id]);
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
      <TextField
        select
        size="small"
        sx={{ minWidth: 280 }}
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        disabled={!canWrite}
      >
        <MenuItem value="">
          <em>None — reports stay unassigned</em>
        </MenuItem>
        {groups.map((g) => (
          <MenuItem key={g.id} value={g.id}>
            {g.name}
          </MenuItem>
        ))}
      </TextField>
      {canWrite && (
        <Button
          variant="contained"
          size="small"
          disabled={!picked || picked === current?.id}
          onClick={() => onSave(picked)}
        >
          Set as default
        </Button>
      )}
      {current && <Chip size="small" label={`Current: ${current.name}`} variant="outlined" />}
    </Stack>
  );
}

function OptionRow({
  option,
  parentLabel,
  canWrite,
  onSave,
}: {
  option: CatalogOption;
  parentLabel: string | null;
  canWrite: boolean;
  onSave: (patch: { label?: string; sortOrder?: number; isActive?: boolean }) => Promise<void>;
}) {
  const [label, setLabel] = useState(option.label);
  const [sortOrder, setSortOrder] = useState(String(option.sortOrder));
  useEffect(() => {
    setLabel(option.label);
    setSortOrder(String(option.sortOrder));
  }, [option.label, option.sortOrder]);
  const dirty = label !== option.label || Number(sortOrder) !== option.sortOrder;
  return (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={1}
      alignItems={{ md: "center" }}
      sx={{
        p: 1,
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        opacity: option.isActive ? 1 : 0.6,
      }}
    >
      <Typography variant="body2" sx={{ fontFamily: "monospace", minWidth: 200 }}>
        {option.value}
        {parentLabel && (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            under {parentLabel}
          </Typography>
        )}
      </Typography>
      <TextField
        size="small"
        label="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        disabled={!canWrite}
        sx={{ flex: 1 }}
      />
      <TextField
        size="small"
        label="Order"
        type="number"
        value={sortOrder}
        onChange={(e) => setSortOrder(e.target.value)}
        disabled={!canWrite}
        sx={{ width: 90 }}
      />
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={option.isActive}
            disabled={!canWrite}
            onChange={(e) => onSave({ isActive: e.target.checked })}
          />
        }
        label="Active"
      />
      {canWrite && (
        <Button
          size="small"
          variant="outlined"
          disabled={!dirty || !label.trim()}
          onClick={() => onSave({ label: label.trim(), sortOrder: Number(sortOrder) || 0 })}
        >
          Save
        </Button>
      )}
    </Stack>
  );
}

function NewOptionForm({
  kind,
  components,
  onCreate,
}: {
  kind: Kind;
  components: CatalogOption[];
  onCreate: (body: {
    kind: Kind;
    value: string;
    label: string;
    sortOrder: number;
    parentId?: string;
  }) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [parentId, setParentId] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  useEffect(() => {
    setValue("");
    setLabel("");
    setParentId("");
  }, [kind]);
  const needsParent = kind === "SUB_COMPONENT";
  const valueOk = VALUE_PATTERN.test(value);
  const ready = valueOk && label.trim().length > 0 && (!needsParent || parentId);
  return (
    <Box sx={{ pt: 2, borderTop: "1px dashed", borderColor: "divider" }}>
      <Typography variant="subtitle2" gutterBottom>
        Add a value
      </Typography>
      <Grid container spacing={1} alignItems="flex-start">
        {needsParent && (
          <Grid item xs={12} sm={3}>
            <TextField
              select
              size="small"
              fullWidth
              label="Component"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              {components.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
        )}
        <Grid item xs={12} sm={3}>
          <TextField
            size="small"
            fullWidth
            label="Code"
            placeholder={kind === "PRIORITY" ? "P1" : "UPPER_SNAKE"}
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            error={value.length > 0 && !valueOk}
            helperText="Stored on tickets; cannot be changed later"
          />
        </Grid>
        <Grid item xs={12} sm={needsParent ? 3 : 4}>
          <TextField
            size="small"
            fullWidth
            label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Grid>
        <Grid item xs={6} sm={1}>
          <TextField
            size="small"
            fullWidth
            label="Order"
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </Grid>
        <Grid item xs={6} sm={2}>
          <Button
            variant="contained"
            size="medium"
            disabled={!ready}
            onClick={() =>
              onCreate({
                kind,
                value,
                label: label.trim(),
                sortOrder: Number(sortOrder) || 0,
                parentId: needsParent ? parentId : undefined,
              }).then(() => {
                setValue("");
                setLabel("");
              })
            }
          >
            Add
          </Button>
        </Grid>
      </Grid>
    </Box>
  );
}

interface TemplateForm {
  name: string;
  subjectDraft: string;
  descriptionDraft: string;
  defaultPriority: string;
  defaultSeverity: string;
  defaultComponent: string;
  defaultSubComponent: string;
  defaultTool: string;
  isActive: boolean;
}

function formFrom(template: Template | null, issueTypeLabel: string): TemplateForm {
  return {
    name: template?.name ?? issueTypeLabel,
    subjectDraft: template?.subjectDraft ?? "",
    descriptionDraft: template?.descriptionDraft ?? "",
    defaultPriority: template?.defaultPriority ?? "",
    defaultSeverity: template?.defaultSeverity ?? "",
    defaultComponent: template?.defaultComponent ?? "",
    defaultSubComponent: template?.defaultSubComponent ?? "",
    defaultTool: template?.defaultTool ?? "",
    isActive: template?.isActive ?? true,
  };
}

function TemplateEditor({
  issueType,
  template,
  options,
  canWrite,
  onSave,
}: {
  issueType: CatalogOption;
  template: Template | null;
  options: CatalogOption[];
  canWrite: boolean;
  onSave: (body: Record<string, unknown>, existing: Template | null) => Promise<void>;
}) {
  const [form, setForm] = useState<TemplateForm>(() => formFrom(template, issueType.label));
  const [open, setOpen] = useState(false);
  useEffect(() => setForm(formFrom(template, issueType.label)), [template, issueType.label]);
  const set = <K extends keyof TemplateForm>(k: K, v: TemplateForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const active = (k: Kind, parentValue?: string) =>
    options.filter(
      (o) =>
        o.kind === k &&
        o.isActive &&
        (parentValue === undefined ||
          o.parentId ===
            options.find((c) => c.kind === "COMPONENT" && c.value === parentValue)?.id),
    );

  const pick = (
    label: string,
    key: keyof TemplateForm,
    list: CatalogOption[],
    disabled = false,
  ) => (
    <TextField
      select
      size="small"
      fullWidth
      label={label}
      value={form[key] as string}
      onChange={(e) => set(key, e.target.value as never)}
      disabled={!canWrite || disabled}
    >
      <MenuItem value="">
        <em>None</em>
      </MenuItem>
      {list.map((o) => (
        <MenuItem key={o.id} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  );

  const save = () => {
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      subjectDraft: form.subjectDraft,
      descriptionDraft: form.descriptionDraft,
      defaultPriority: form.defaultPriority,
      defaultSeverity: form.defaultSeverity,
      defaultComponent: form.defaultComponent,
      defaultSubComponent: form.defaultSubComponent,
      defaultTool: form.defaultTool,
    };
    if (template) {
      body.isActive = form.isActive;
    } else {
      // Create: empty strings aren't accepted as "none", omit them.
      for (const k of Object.keys(body)) if (body[k] === "") delete body[k];
    }
    void onSave(body, template);
  };

  return (
    <Box sx={{ p: 1.5, borderRadius: 1, border: "1px solid", borderColor: "divider" }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography sx={{ fontWeight: 600, flex: 1 }}>
          {issueType.label}
          {!issueType.isActive && <Chip size="small" label="issue type retired" sx={{ ml: 1 }} />}
        </Typography>
        {template ? (
          <Chip
            size="small"
            color={template.isActive ? "success" : "default"}
            label={template.isActive ? "Template active" : "Template retired"}
            variant="outlined"
          />
        ) : (
          <Chip size="small" label="No template yet" variant="outlined" />
        )}
        <Button size="small" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : template ? "Edit" : "Create"}
        </Button>
      </Stack>
      {open && (
        <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
          <Grid item xs={12} sm={6}>
            <TextField
              size="small"
              fullWidth
              label="Template name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              disabled={!canWrite}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              size="small"
              fullWidth
              label="Subject draft"
              placeholder="[Hardware] <device> - <symptom>"
              value={form.subjectDraft}
              onChange={(e) => set("subjectDraft", e.target.value)}
              disabled={!canWrite}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={4}
              label="Description draft"
              placeholder={"Device:\nWhat you can see:\nWhen did it start?"}
              value={form.descriptionDraft}
              onChange={(e) => set("descriptionDraft", e.target.value)}
              disabled={!canWrite}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            {pick("Default priority", "defaultPriority", active("PRIORITY"))}
          </Grid>
          <Grid item xs={6} sm={3}>
            {pick("Default severity", "defaultSeverity", active("SEVERITY"))}
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              select
              size="small"
              fullWidth
              label="Default component"
              value={form.defaultComponent}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  defaultComponent: e.target.value,
                  defaultSubComponent: "",
                }))
              }
              disabled={!canWrite}
            >
              <MenuItem value="">
                <em>None</em>
              </MenuItem>
              {active("COMPONENT").map((o) => (
                <MenuItem key={o.id} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} sm={3}>
            {pick(
              "Default sub component",
              "defaultSubComponent",
              form.defaultComponent ? active("SUB_COMPONENT", form.defaultComponent) : [],
              !form.defaultComponent,
            )}
          </Grid>
          <Grid item xs={6} sm={3}>
            {pick("Default tool", "defaultTool", active("TOOL"))}
          </Grid>
          {template && (
            <Grid item xs={6} sm={3}>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={form.isActive}
                    disabled={!canWrite}
                    onChange={(e) => set("isActive", e.target.checked)}
                  />
                }
                label="Active"
              />
            </Grid>
          )}
          {canWrite && (
            <Grid item xs={12}>
              <Button
                variant="contained"
                size="small"
                disabled={!form.name.trim() || !form.descriptionDraft.trim()}
                onClick={save}
              >
                {template ? "Save template" : "Create template"}
              </Button>
            </Grid>
          )}
        </Grid>
      )}
    </Box>
  );
}
