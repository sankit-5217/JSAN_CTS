import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  Link,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from "../api/client";

const WORKLOG_ACTIVITY_TYPES = ["REMOTE_WORK", "ONSITE", "TRAVEL", "VENDOR_CALL"];
const IMPACT_URGENCY_VALUES = ["HIGH", "MEDIUM", "LOW"];
const PRIORITY_VALUES = ["P1", "P2", "P3", "P4"];

// A field name as it appears in TransitionRule.requiredFields on the
// backend (apps/api/src/modules/incidents/incident-transitions.ts).
type TransitionField = "reason" | "resolutionCategory" | "rootCauseSummary";

interface AvailableTransition {
  toStatus: string;
  requiredFields: TransitionField[];
  allowed: boolean;
  blockedReason?: string;
  /** E.g. NEW -> ASSIGNED needs an owner resolved — not a requiredFields
   * entry (that's reason/resolutionCategory/rootCauseSummary only), so the
   * backend surfaces it here instead. */
  hint?: string;
}

interface Incident {
  id: string;
  incidentNo: string;
  siteId: string;
  ciId: string | null;
  status: string;
  priority: string;
  category: string;
  impact: string;
  urgency: string;
  shortDescription: string;
  ownerUserId: string | null;
  ownerGroupId: string | null;
  acknowledgedAt: string | null;
  resolutionCategory: string | null;
  rootCauseSummary: string | null;
  restoredAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

interface SlaState {
  ackDueAt: string | null;
  ackedAt: string | null;
  resolveDueAt: string | null;
  resolvedAt: string | null;
  pausedAt: string | null;
  breached: boolean;
}

interface IncidentEvent {
  id: string;
  eventType: string;
  actorId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface Comment {
  id: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

interface Worklog {
  id: string;
  engineerId: string;
  activityType: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  billable: boolean | null;
  notes: string | null;
  editReason: string | null;
}

interface Attachment {
  id: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

interface CiOption {
  id: string;
  ciCode: string;
  name: string;
}

interface EngineerOption {
  id: string;
  displayName: string;
  email: string;
}

interface GroupOption {
  id: string;
  name: string;
}

interface VendorCase {
  id: string;
  vendorCaseNo: string;
  vendorId: string;
  dispatchStatus: string | null;
  rmaRequired: boolean;
  closedAt: string | null;
}

const PRIORITY_COLOR: Record<string, "error" | "warning" | "info" | "default"> = {
  P1: "error",
  P2: "warning",
  P3: "info",
  P4: "default",
};

function humanDuration(ms: number): string {
  const totalMinutes = Math.round(Math.abs(ms) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Load-time snapshot, not a live-ticking clock (plan Decision 5). */
function slaCountdown(
  dueAt: string | null,
  stoppedAt: string | null,
  pausedAt: string | null,
): string {
  if (!dueAt) return "—";
  if (stoppedAt)
    return `stopped (${humanDuration(Date.now() - new Date(stoppedAt).getTime())} ago)`;
  if (pausedAt) return "paused";
  const diffMs = new Date(dueAt).getTime() - Date.now();
  return diffMs < 0 ? `breached ${humanDuration(diffMs)} ago` : `due in ${humanDuration(diffMs)}`;
}

/**
 * Assign-to-engineer picker, used in both the edit panel and the transition
 * panel — each instance keeps its own query/options so picking a different
 * engineer while assigning doesn't affect what the edit panel shows. Scoped
 * to `siteId` server-side (GET /users?role=SITE_ENGINEER&siteId=...), same
 * "no q at all when empty" pattern as the CI picker so it lists the site's
 * whole engineer roster by default instead of requiring a name first.
 */
function EngineerPicker({
  siteId,
  value,
  onChange,
  label,
}: {
  siteId: string;
  value: EngineerOption | null;
  onChange: (value: EngineerOption | null) => void;
  label: string;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<EngineerOption[]>([]);

  useEffect(() => {
    const qParam = query ? `&q=${encodeURIComponent(query)}` : "";
    apiGet<EngineerOption[]>(`/users?role=SITE_ENGINEER&siteId=${siteId}${qParam}`)
      .then(setOptions)
      .catch(() => undefined);
  }, [query, siteId]);

  return (
    <Autocomplete
      options={options}
      getOptionLabel={(o) => `${o.displayName} (${o.email})`}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      value={value}
      onChange={(_, v) => onChange(v)}
      inputValue={query}
      onInputChange={(_, v) => setQuery(v)}
      openOnFocus
      noOptionsText="No engineers assigned to this site"
      renderInput={(params) => <TextField {...params} label={label} size="small" />}
    />
  );
}

/** Support groups are a short, site-independent list (GET /support-groups
 * has no query params at all) — client-side filtering is enough, no search
 * round-trip needed. `options` is fetched once at the page level and shared
 * by every instance instead of each picker re-fetching the same list. */
function GroupPicker({
  options,
  value,
  onChange,
  label,
}: {
  options: GroupOption[];
  value: GroupOption | null;
  onChange: (value: GroupOption | null) => void;
  label: string;
}) {
  return (
    <Autocomplete
      options={options}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      value={value}
      onChange={(_, v) => onChange(v)}
      openOnFocus
      noOptionsText="No support groups yet"
      renderInput={(params) => <TextField {...params} label={label} size="small" />}
    />
  );
}

/**
 * Incident workspace (frontend-depth plan, Steps 3-4): header, SLA
 * countdown snapshot, status transition, comments, worklogs (add +
 * correct), attachments (upload + download), and a merged timeline.
 * Every write submits straight to its existing, already-authorized/
 * audited backend endpoint and refetches on success — no optimistic
 * local state. The transition dropdown doesn't mirror the rule table
 * client-side either (plan Decision 2) — it renders whatever
 * GET /incidents/:id/transitions computes from the one rule table the
 * transition endpoint itself enforces.
 */
export function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [sla, setSla] = useState<SlaState | null>(null);
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [worklogs, setWorklogs] = useState<Worklog[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [availableTransitions, setAvailableTransitions] = useState<AvailableTransition[]>([]);
  const [vendorCases, setVendorCases] = useState<VendorCase[]>([]);
  const [supportGroups, setSupportGroups] = useState<GroupOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Fetched once, not per-incident — the whole app shares one support-group
  // register (GET /support-groups isn't site-scoped, see support-groups.controller.ts).
  useEffect(() => {
    apiGet<GroupOption[]>("/support-groups")
      .then(setSupportGroups)
      .catch(() => undefined);
  }, []);

  const refetch = useCallback(() => {
    if (!id) return;
    setError(null);
    Promise.all([
      apiGet<Incident>(`/incidents/${id}`),
      apiGet<SlaState | null>(`/incidents/${id}/sla`),
      apiGet<IncidentEvent[]>(`/incidents/${id}/events`),
      apiGet<Comment[]>(`/incidents/${id}/comments`),
      apiGet<Worklog[]>(`/incidents/${id}/worklogs`),
      apiGet<Attachment[]>(`/incidents/${id}/attachments`),
      apiGet<AvailableTransition[]>(`/incidents/${id}/transitions`),
      apiGet<VendorCase[]>(`/vendor-cases?linkedIncidentId=${id}`),
    ])
      .then(([inc, slaState, evts, cmts, wls, atts, transitions, vCases]) => {
        setIncident(inc);
        setSla(slaState);
        setEvents(evts);
        setComments(cmts);
        setWorklogs(wls);
        setAttachments(atts);
        setAvailableTransitions(transitions);
        setVendorCases(vCases);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // --- Edit incident form --------------------------------------------------
  // Seeded from the incident once per incident id, not on every refetch, so
  // a mid-edit refetch (e.g. someone else posts a comment) doesn't clobber
  // what's being typed.
  const [editShortDescription, setEditShortDescription] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editImpact, setEditImpact] = useState("");
  const [editUrgency, setEditUrgency] = useState("");
  const [editPriority, setEditPriority] = useState("");
  const [editPriorityChangeReason, setEditPriorityChangeReason] = useState("");
  const [editOwnerUser, setEditOwnerUser] = useState<EngineerOption | null>(null);
  const [editOwnerGroup, setEditOwnerGroup] = useState<GroupOption | null>(null);
  const [ciQuery, setCiQuery] = useState("");
  const [ciOptions, setCiOptions] = useState<CiOption[]>([]);
  const [selectedCi, setSelectedCi] = useState<CiOption | null>(null);

  useEffect(() => {
    if (!incident) return;
    setEditShortDescription(incident.shortDescription);
    setEditCategory(incident.category);
    setEditImpact(incident.impact);
    setEditUrgency(incident.urgency);
    setEditPriority(incident.priority);
    setEditPriorityChangeReason("");
    // The incident only carries owner/CI ids, not readable names — resolve
    // each to show a name instead of a raw UUID. Not `refetch`'s problem to
    // fold in: this only needs to happen once per incident, same as
    // everything else in this effect.
    if (incident.ownerUserId) {
      apiGet<EngineerOption>(`/users/${incident.ownerUserId}`)
        .then(setEditOwnerUser)
        .catch(() => setEditOwnerUser(null));
    } else {
      setEditOwnerUser(null);
    }
    setEditOwnerGroup(
      incident.ownerGroupId
        ? (supportGroups.find((g) => g.id === incident.ownerGroupId) ?? null)
        : null,
    );
    if (incident.ciId) {
      apiGet<CiOption>(`/cis/${incident.ciId}`)
        .then(setSelectedCi)
        .catch(() => setSelectedCi(null));
    } else {
      setSelectedCi(null);
    }
    setCiQuery("");
    // Only re-seed when a different incident loads, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident?.id, supportGroups]);

  useEffect(() => {
    if (!incident) {
      setCiOptions([]);
      return;
    }
    // No `q` filter at all when the field's empty — the backend already
    // treats that as "no filter" (cmdb.service.ts's findAll), so this
    // lists the site's whole CMDB inventory by default rather than
    // requiring the engineer to already know a code before anything shows.
    const qParam = ciQuery ? `&q=${encodeURIComponent(ciQuery)}` : "";
    apiGet<{ items: CiOption[] }>(`/cis?siteId=${incident.siteId}${qParam}`)
      .then((res) => setCiOptions(res.items))
      .catch(() => undefined);
  }, [ciQuery, incident]);

  const priorityChanged = incident !== null && editPriority !== incident.priority;

  const submitEdit = async () => {
    if (!id) return;
    setActionError(null);
    try {
      await apiPatch(`/incidents/${id}`, {
        shortDescription: editShortDescription,
        category: editCategory,
        impact: editImpact,
        urgency: editUrgency,
        // The backend requires priorityChangeReason whenever `priority` is
        // present in the body at all (spec §16), not just when it differs
        // from the current value — so only include the key when it's
        // actually being changed, same as priorityChangeReason itself.
        priority: priorityChanged ? editPriority : undefined,
        priorityChangeReason: priorityChanged ? editPriorityChangeReason : undefined,
        ciId: selectedCi?.id,
        ownerUserId: editOwnerUser?.id,
        ownerGroupId: editOwnerGroup?.id,
      });
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Transition form ---------------------------------------------------
  const [toStatus, setToStatus] = useState("");
  const [reason, setReason] = useState("");
  const [resolutionCategory, setResolutionCategory] = useState("");
  const [rootCauseSummary, setRootCauseSummary] = useState("");
  const [transitionOwnerUser, setTransitionOwnerUser] = useState<EngineerOption | null>(null);
  const [transitionOwnerGroup, setTransitionOwnerGroup] = useState<GroupOption | null>(null);
  const selectedTransition = availableTransitions.find((t) => t.toStatus === toStatus);
  const requiredFields = selectedTransition?.requiredFields ?? [];

  const submitTransition = async () => {
    if (!id || !toStatus) return;
    setActionError(null);
    try {
      await apiPost(`/incidents/${id}/transition`, {
        toStatus,
        reason: reason || undefined,
        resolutionCategory: resolutionCategory || undefined,
        rootCauseSummary: rootCauseSummary || undefined,
        ownerUserId: transitionOwnerUser?.id,
        ownerGroupId: transitionOwnerGroup?.id,
      });
      setToStatus("");
      setReason("");
      setResolutionCategory("");
      setRootCauseSummary("");
      setTransitionOwnerUser(null);
      setTransitionOwnerGroup(null);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Comment form --------------------------------------------------------
  const [commentBody, setCommentBody] = useState("");
  const [commentInternal, setCommentInternal] = useState(true);

  const submitComment = async () => {
    if (!id || !commentBody) return;
    setActionError(null);
    try {
      await apiPost(`/incidents/${id}/comments`, {
        body: commentBody,
        isInternal: commentInternal,
      });
      setCommentBody("");
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Worklog form ----------------------------------------------------
  const [activityType, setActivityType] = useState(WORKLOG_ACTIVITY_TYPES[0]);
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [worklogNotes, setWorklogNotes] = useState("");
  const [billable, setBillable] = useState(false);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [editReason, setEditReason] = useState("");

  const submitWorklog = async () => {
    if (!id || !startedAt) return;
    setActionError(null);
    try {
      await apiPost(`/incidents/${id}/worklogs`, {
        activityType,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: endedAt ? new Date(endedAt).toISOString() : undefined,
        notes: worklogNotes || undefined,
        billable,
      });
      setStartedAt("");
      setEndedAt("");
      setWorklogNotes("");
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const submitCorrection = async (worklogId: string) => {
    if (!editReason) return;
    setActionError(null);
    try {
      await apiPatch(`/worklogs/${worklogId}`, { editReason });
      setCorrectingId(null);
      setEditReason("");
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Attachments -------------------------------------------------------
  const uploadFile = async (file: File) => {
    if (!id) return;
    setActionError(null);
    try {
      await apiUpload(`/incidents/${id}/attachments`, file);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const downloadAttachment = async (attachmentId: string) => {
    if (!id) return;
    setActionError(null);
    try {
      const { url } = await apiGet<{ url: string }>(
        `/incidents/${id}/attachments/${attachmentId}/download`,
      );
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeAttachment = async (attachmentId: string) => {
    if (!id) return;
    if (!window.confirm("Remove this attachment? It won't be downloadable anymore.")) return;
    setActionError(null);
    try {
      await apiDelete(`/incidents/${id}/attachments/${attachmentId}`);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return (
      <Alert severity="error">
        Could not load incident {id}: {error}
      </Alert>
    );
  }
  if (!incident) {
    return <Typography color="text.secondary">Loading...</Typography>;
  }

  return (
    <Box>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h5">{incident.incidentNo}</Typography>
            <Chip label={incident.status} />
            <Chip label={incident.priority} color={PRIORITY_COLOR[incident.priority]} />
          </Stack>
          <Typography variant="body1" sx={{ mb: 1 }}>
            {incident.shortDescription}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {incident.category} · impact {incident.impact} · urgency {incident.urgency}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Owner: {editOwnerUser?.displayName ?? (incident.ownerUserId ? "…" : "unassigned")}
            {" · "}
            Group: {editOwnerGroup?.name ?? (incident.ownerGroupId ? "…" : "unassigned")}
          </Typography>
          {sla && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Ack: {slaCountdown(sla.ackDueAt, sla.ackedAt, null)} · Resolve:{" "}
              {slaCountdown(sla.resolveDueAt, sla.resolvedAt, sla.pausedAt)}
              {sla.breached && (
                <Chip size="small" color="error" label="SLA BREACHED" sx={{ ml: 1 }} />
              )}
            </Typography>
          )}
        </CardContent>
      </Card>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Edit incident
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Short description"
              size="small"
              fullWidth
              value={editShortDescription}
              onChange={(e) => setEditShortDescription(e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Category"
              size="small"
              fullWidth
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
            />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              select
              label="Impact"
              size="small"
              fullWidth
              value={editImpact}
              onChange={(e) => setEditImpact(e.target.value)}
            >
              {IMPACT_URGENCY_VALUES.map((v) => (
                <MenuItem key={v} value={v}>
                  {v}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              select
              label="Urgency"
              size="small"
              fullWidth
              value={editUrgency}
              onChange={(e) => setEditUrgency(e.target.value)}
            >
              {IMPACT_URGENCY_VALUES.map((v) => (
                <MenuItem key={v} value={v}>
                  {v}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField
              select
              label="Priority"
              size="small"
              fullWidth
              value={editPriority}
              onChange={(e) => setEditPriority(e.target.value)}
            >
              {PRIORITY_VALUES.map((v) => (
                <MenuItem key={v} value={v}>
                  {v}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          {priorityChanged && (
            <Grid item xs={12} sm={6}>
              <TextField
                label="Reason for priority change"
                size="small"
                fullWidth
                required
                value={editPriorityChangeReason}
                onChange={(e) => setEditPriorityChangeReason(e.target.value)}
              />
            </Grid>
          )}
          <Grid item xs={12}>
            <Autocomplete
              options={ciOptions}
              getOptionLabel={(o) => `${o.ciCode} — ${o.name}`}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              value={selectedCi}
              onChange={(_, value) => setSelectedCi(value)}
              inputValue={ciQuery}
              onInputChange={(_, value) => setCiQuery(value)}
              openOnFocus
              noOptionsText="No CIs found at this site"
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Affected CI (search by code or name, or click to browse)"
                  size="small"
                  helperText="Which server/rack/PDU this ticket is actually about — links it into the CMDB for alert correlation and history."
                />
              )}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <EngineerPicker
              siteId={incident.siteId}
              value={editOwnerUser}
              onChange={setEditOwnerUser}
              label="Owner (engineer)"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <GroupPicker
              options={supportGroups}
              value={editOwnerGroup}
              onChange={setEditOwnerGroup}
              label="Owner group"
            />
          </Grid>
          <Grid item xs={12}>
            <Button
              variant="contained"
              disabled={
                !editShortDescription ||
                !editCategory ||
                (priorityChanged && !editPriorityChangeReason)
              }
              onClick={submitEdit}
            >
              Save changes
            </Button>
          </Grid>
        </Grid>
      </Paper>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Change status
            </Typography>
            {availableTransitions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No status changes are available to you for this ticket right now — either its
                current status ({incident.status}) has no further moves, or none of them are your
                role's to make.
              </Typography>
            ) : (
              <Stack spacing={2}>
                <TextField
                  select
                  label="New status"
                  size="small"
                  value={toStatus}
                  onChange={(e) => setToStatus(e.target.value)}
                  helperText={
                    selectedTransition && !selectedTransition.allowed
                      ? selectedTransition.blockedReason
                      : undefined
                  }
                  error={selectedTransition ? !selectedTransition.allowed : false}
                >
                  {availableTransitions.map((t) => (
                    <MenuItem key={t.toStatus} value={t.toStatus} disabled={!t.allowed}>
                      {t.toStatus}
                      {!t.allowed && " (blocked)"}
                    </MenuItem>
                  ))}
                </TextField>
                {selectedTransition?.hint && (
                  <Alert severity="info">{selectedTransition.hint}</Alert>
                )}
                <TextField
                  label="Reason"
                  size="small"
                  required={requiredFields.includes("reason")}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <TextField
                  label="Resolution category"
                  size="small"
                  required={requiredFields.includes("resolutionCategory")}
                  value={resolutionCategory}
                  onChange={(e) => setResolutionCategory(e.target.value)}
                />
                <TextField
                  label="Root cause summary"
                  size="small"
                  multiline
                  required={requiredFields.includes("rootCauseSummary")}
                  value={rootCauseSummary}
                  onChange={(e) => setRootCauseSummary(e.target.value)}
                />
                <EngineerPicker
                  siteId={incident.siteId}
                  value={transitionOwnerUser}
                  onChange={setTransitionOwnerUser}
                  label="Assign to engineer"
                />
                <GroupPicker
                  options={supportGroups}
                  value={transitionOwnerGroup}
                  onChange={setTransitionOwnerGroup}
                  label="Assign to group"
                />
                <Button
                  variant="contained"
                  disabled={
                    !toStatus ||
                    selectedTransition?.allowed === false ||
                    requiredFields.some((f) =>
                      f === "reason"
                        ? !reason
                        : f === "resolutionCategory"
                          ? !resolutionCategory
                          : !rootCauseSummary,
                    )
                  }
                  onClick={submitTransition}
                >
                  Submit transition
                </Button>
              </Stack>
            )}
          </Paper>

          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Comments
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {comments.map((c) => (
                <Box key={c.id}>
                  <Typography variant="body2">
                    {c.body} {c.isInternal && <Chip size="small" label="internal" />}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {c.authorId} · {new Date(c.createdAt).toLocaleString()}
                  </Typography>
                  <Divider sx={{ mt: 1 }} />
                </Box>
              ))}
              {comments.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No comments yet.
                </Typography>
              )}
            </Stack>
            <TextField
              fullWidth
              multiline
              size="small"
              label="Add comment"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              sx={{ mb: 1 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={commentInternal}
                  onChange={(e) => setCommentInternal(e.target.checked)}
                />
              }
              label="Internal (not customer-visible)"
            />
            <Button variant="contained" disabled={!commentBody} onClick={submitComment}>
              Post comment
            </Button>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Attachments
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {attachments.map((a) => (
                <Stack key={a.id} direction="row" spacing={2} alignItems="center">
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {a.objectKey.split("/").pop()} ({(a.sizeBytes / 1024).toFixed(1)} KB)
                  </Typography>
                  <Button size="small" onClick={() => downloadAttachment(a.id)}>
                    Download
                  </Button>
                  <Button size="small" color="error" onClick={() => removeAttachment(a.id)}>
                    Remove
                  </Button>
                </Stack>
              ))}
              {attachments.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No attachments yet.
                </Typography>
              )}
            </Stack>
            <Button component="label" variant="outlined">
              Upload file
              <input
                type="file"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadFile(file);
                  e.target.value = "";
                }}
              />
            </Button>
          </Paper>

          <Paper sx={{ p: 2, mt: 3 }}>
            <Typography variant="h6" gutterBottom>
              Vendor cases
            </Typography>
            <Stack spacing={1}>
              {vendorCases.map((vc) => (
                <Stack
                  key={vc.id}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  divider={<Divider orientation="vertical" flexItem />}
                >
                  <Link component={RouterLink} to={`/vendor-cases/${vc.id}`}>
                    {vc.vendorCaseNo}
                  </Link>
                  <Typography variant="body2" color="text.secondary">
                    {vc.dispatchStatus ?? "no dispatch yet"}
                  </Typography>
                  {vc.rmaRequired && <Chip size="small" label="RMA" />}
                  <Chip
                    size="small"
                    label={vc.closedAt ? "closed" : "open"}
                    color={vc.closedAt ? "default" : "warning"}
                  />
                </Stack>
              ))}
              {vendorCases.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No vendor cases linked to this ticket. Open one from the{" "}
                  <Link component={RouterLink} to="/vendors">
                    Vendors
                  </Link>{" "}
                  page and link this incident's ID.
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Worklogs
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {worklogs.map((w) => (
                <Box key={w.id}>
                  <Typography variant="body2">
                    {w.activityType} — {new Date(w.startedAt).toLocaleString()}
                    {w.endedAt && ` → ${new Date(w.endedAt).toLocaleString()}`}
                    {w.durationMinutes !== null && ` (${w.durationMinutes}m)`}
                    {w.billable && <Chip size="small" label="billable" sx={{ ml: 1 }} />}
                  </Typography>
                  {w.notes && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {w.notes}
                    </Typography>
                  )}
                  {w.editReason && (
                    <Typography variant="caption" color="warning.main" display="block">
                      Corrected: {w.editReason}
                    </Typography>
                  )}
                  {correctingId === w.id ? (
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                      <TextField
                        size="small"
                        label="Reason for correction"
                        value={editReason}
                        onChange={(e) => setEditReason(e.target.value)}
                      />
                      <Button
                        size="small"
                        disabled={!editReason}
                        onClick={() => submitCorrection(w.id)}
                      >
                        Save
                      </Button>
                      <Button size="small" onClick={() => setCorrectingId(null)}>
                        Cancel
                      </Button>
                    </Stack>
                  ) : (
                    <Button size="small" onClick={() => setCorrectingId(w.id)}>
                      Correct
                    </Button>
                  )}
                  <Divider sx={{ mt: 1 }} />
                </Box>
              ))}
              {worklogs.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No worklogs yet.
                </Typography>
              )}
            </Stack>
            <Stack spacing={2}>
              <TextField
                select
                size="small"
                label="Activity type"
                value={activityType}
                onChange={(e) => setActivityType(e.target.value)}
              >
                {WORKLOG_ACTIVITY_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                type="datetime-local"
                size="small"
                label="Started at"
                InputLabelProps={{ shrink: true }}
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
              />
              <TextField
                type="datetime-local"
                size="small"
                label="Ended at (optional)"
                InputLabelProps={{ shrink: true }}
                value={endedAt}
                onChange={(e) => setEndedAt(e.target.value)}
              />
              <TextField
                size="small"
                label="Notes"
                value={worklogNotes}
                onChange={(e) => setWorklogNotes(e.target.value)}
              />
              <FormControlLabel
                control={
                  <Checkbox checked={billable} onChange={(e) => setBillable(e.target.checked)} />
                }
                label="Billable"
              />
              <Button variant="contained" disabled={!startedAt} onClick={submitWorklog}>
                Log time
              </Button>
            </Stack>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Timeline
            </Typography>
            <Stack spacing={1}>
              {events.map((e) => (
                <Box key={e.id}>
                  <Typography variant="body2">
                    <strong>{e.eventType}</strong> — {new Date(e.createdAt).toLocaleString()}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {JSON.stringify(e.payload)}
                  </Typography>
                  <Divider sx={{ mt: 1 }} />
                </Box>
              ))}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
