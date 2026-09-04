import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { apiGet, apiPatch, apiPost, apiUpload } from "../api/client";

// Literal string unions mirroring the Prisma enums (same CJS/ESM-interop
// workaround as IncidentsPage.tsx/CisPage.tsx — see IncidentsPage's comment).
const INCIDENT_STATUSES = [
  "NEW",
  "ASSIGNED",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "PENDING_VENDOR",
  "PENDING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "CANCELLED",
];
const WORKLOG_ACTIVITY_TYPES = ["REMOTE_WORK", "ONSITE", "TRAVEL", "VENDOR_CALL"];

interface Incident {
  id: string;
  incidentNo: string;
  siteId: string;
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
 * Incident workspace (frontend-depth plan, Steps 3-4): header, SLA
 * countdown snapshot, status transition, comments, worklogs (add +
 * correct), attachments (upload + download), and a merged timeline.
 * Every write submits straight to its existing, already-authorized/
 * audited backend endpoint and refetches on success — no client-side
 * transition-rule mirroring (plan Decision 2) or optimistic local state.
 */
export function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [sla, setSla] = useState<SlaState | null>(null);
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [worklogs, setWorklogs] = useState<Worklog[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
    ])
      .then(([inc, slaState, evts, cmts, wls, atts]) => {
        setIncident(inc);
        setSla(slaState);
        setEvents(evts);
        setComments(cmts);
        setWorklogs(wls);
        setAttachments(atts);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // --- Transition form ---------------------------------------------------
  const [toStatus, setToStatus] = useState("");
  const [reason, setReason] = useState("");
  const [resolutionCategory, setResolutionCategory] = useState("");
  const [rootCauseSummary, setRootCauseSummary] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [ownerGroupId, setOwnerGroupId] = useState("");

  const submitTransition = async () => {
    if (!id || !toStatus) return;
    setActionError(null);
    try {
      await apiPost(`/incidents/${id}/transition`, {
        toStatus,
        reason: reason || undefined,
        resolutionCategory: resolutionCategory || undefined,
        rootCauseSummary: rootCauseSummary || undefined,
        ownerUserId: ownerUserId || undefined,
        ownerGroupId: ownerGroupId || undefined,
      });
      setToStatus("");
      setReason("");
      setResolutionCategory("");
      setRootCauseSummary("");
      setOwnerUserId("");
      setOwnerGroupId("");
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
            Owner user: {incident.ownerUserId ?? "unassigned"} · Owner group:{" "}
            {incident.ownerGroupId ?? "unassigned"}
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

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Change status
            </Typography>
            <Stack spacing={2}>
              <TextField
                select
                label="New status"
                size="small"
                value={toStatus}
                onChange={(e) => setToStatus(e.target.value)}
              >
                {INCIDENT_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Reason"
                size="small"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <TextField
                label="Resolution category (RESOLVED only)"
                size="small"
                value={resolutionCategory}
                onChange={(e) => setResolutionCategory(e.target.value)}
              />
              <TextField
                label="Root cause summary (RESOLVED only)"
                size="small"
                multiline
                value={rootCauseSummary}
                onChange={(e) => setRootCauseSummary(e.target.value)}
              />
              <TextField
                label="Owner user ID (UUID)"
                size="small"
                value={ownerUserId}
                onChange={(e) => setOwnerUserId(e.target.value)}
              />
              <TextField
                label="Owner group ID (UUID)"
                size="small"
                value={ownerGroupId}
                onChange={(e) => setOwnerGroupId(e.target.value)}
              />
              <Button variant="contained" disabled={!toStatus} onClick={submitTransition}>
                Submit transition
              </Button>
            </Stack>
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
