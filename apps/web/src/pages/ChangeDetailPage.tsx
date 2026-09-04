import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert as MuiAlert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { apiGet, apiPatch, apiPost } from "../api/client";

interface Change {
  id: string;
  changeType: string;
  reason: string;
  implementationPlan: string;
  rollbackPlan: string;
  risk: string;
  windowStart: string;
  windowEnd: string;
  approverId: string | null;
  outcome: string | null;
  affectedCiIds: string[];
  status: string;
  pirOverdue: boolean;
}

const EDITABLE = new Set(["PENDING_APPROVAL", "SCHEDULED"]);

function toLocalInput(iso: string): string {
  // trim seconds/zone for <input type="datetime-local">
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

function splitIds(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Change workspace (spec §10.6): plan / window / affected-CI edits (accepted
 * only before work starts — backend-enforced), single-approver approval, and
 * the completion / PIR outcome. Status is derived, never set here.
 */
export function ChangeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [change, setChange] = useState<Change | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!id) return;
    setError(null);
    apiGet<Change>(`/changes/${id}`)
      .then(setChange)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const [approverId, setApproverId] = useState("");
  const [outcome, setOutcome] = useState("");
  const [edit, setEdit] = useState<null | {
    reason: string;
    implementationPlan: string;
    rollbackPlan: string;
    risk: string;
    windowStart: string;
    windowEnd: string;
    affectedCiIds: string;
  }>(null);

  const call = async (fn: () => Promise<unknown>, reset?: () => void) => {
    setActionError(null);
    try {
      await fn();
      reset?.();
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return (
      <MuiAlert severity="error">
        Could not load change {id}: {error}
      </MuiAlert>
    );
  }
  if (!change) {
    return <Typography color="text.secondary">Loading...</Typography>;
  }

  const startEdit = () =>
    setEdit({
      reason: change.reason,
      implementationPlan: change.implementationPlan,
      rollbackPlan: change.rollbackPlan,
      risk: change.risk,
      windowStart: toLocalInput(change.windowStart),
      windowEnd: toLocalInput(change.windowEnd),
      affectedCiIds: change.affectedCiIds.join(" "),
    });

  return (
    <Box>
      <Link component={RouterLink} to="/changes" sx={{ display: "inline-block", mb: 2 }}>
        ← All changes
      </Link>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h5">{change.changeType} change</Typography>
            <Chip label={change.status} />
            {change.pirOverdue && <Chip label="PIR overdue" color="error" />}
          </Stack>
          <Typography variant="body1" sx={{ mb: 1 }}>
            {change.reason}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Window: {new Date(change.windowStart).toLocaleString()} →{" "}
            {new Date(change.windowEnd).toLocaleString()}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Approver: {change.approverId ?? "not approved"} · Affected CIs:{" "}
            {change.affectedCiIds.length ? change.affectedCiIds.join(", ") : "site-wide"}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            <strong>Implementation:</strong> {change.implementationPlan}
          </Typography>
          <Typography variant="body2">
            <strong>Rollback:</strong> {change.rollbackPlan}
          </Typography>
          <Typography variant="body2">
            <strong>Risk:</strong> {change.risk}
          </Typography>
          {change.outcome && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              <strong>Outcome:</strong> {change.outcome}
            </Typography>
          )}
        </CardContent>
      </Card>

      {actionError && (
        <MuiAlert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </MuiAlert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Approval
            </Typography>
            {change.approverId ? (
              <Typography variant="body2" color="text.secondary">
                Approved by {change.approverId}.
              </Typography>
            ) : (
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  label="Approver user id"
                  value={approverId}
                  onChange={(e) => setApproverId(e.target.value)}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="contained"
                  disabled={!approverId}
                  onClick={() =>
                    call(() => apiPost(`/changes/${id}/approve`, { approverId }), () =>
                      setApproverId(""),
                    )
                  }
                >
                  Approve
                </Button>
              </Stack>
            )}
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Outcome / PIR
            </Typography>
            <Stack spacing={1}>
              <TextField
                size="small"
                multiline
                label="Completion notes / post-implementation review"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
              />
              <Button
                variant="contained"
                disabled={!outcome}
                onClick={() =>
                  call(() => apiPatch(`/changes/${id}`, { outcome }), () => setOutcome(""))
                }
              >
                Record outcome
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="h6">Plan &amp; window</Typography>
              {EDITABLE.has(change.status) && !edit && (
                <Button size="small" onClick={startEdit}>
                  Edit
                </Button>
              )}
            </Stack>
            {!EDITABLE.has(change.status) && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Plan and window can only change before work starts.
              </Typography>
            )}
            {edit && (
              <Stack spacing={2} sx={{ mt: 2 }}>
                <TextField
                  size="small"
                  label="Reason"
                  value={edit.reason}
                  onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
                />
                <TextField
                  size="small"
                  multiline
                  label="Implementation plan"
                  value={edit.implementationPlan}
                  onChange={(e) => setEdit({ ...edit, implementationPlan: e.target.value })}
                />
                <TextField
                  size="small"
                  multiline
                  label="Rollback plan"
                  value={edit.rollbackPlan}
                  onChange={(e) => setEdit({ ...edit, rollbackPlan: e.target.value })}
                />
                <TextField
                  size="small"
                  label="Risk"
                  value={edit.risk}
                  onChange={(e) => setEdit({ ...edit, risk: e.target.value })}
                />
                <TextField
                  type="datetime-local"
                  size="small"
                  label="Window start"
                  InputLabelProps={{ shrink: true }}
                  value={edit.windowStart}
                  onChange={(e) => setEdit({ ...edit, windowStart: e.target.value })}
                />
                <TextField
                  type="datetime-local"
                  size="small"
                  label="Window end"
                  InputLabelProps={{ shrink: true }}
                  value={edit.windowEnd}
                  onChange={(e) => setEdit({ ...edit, windowEnd: e.target.value })}
                />
                <TextField
                  size="small"
                  multiline
                  label="Affected CI ids (blank = site-wide)"
                  value={edit.affectedCiIds}
                  onChange={(e) => setEdit({ ...edit, affectedCiIds: e.target.value })}
                />
                <Divider />
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    onClick={() =>
                      call(
                        () =>
                          apiPatch(`/changes/${id}`, {
                            reason: edit.reason,
                            implementationPlan: edit.implementationPlan,
                            rollbackPlan: edit.rollbackPlan,
                            risk: edit.risk,
                            windowStart: new Date(edit.windowStart).toISOString(),
                            windowEnd: new Date(edit.windowEnd).toISOString(),
                            affectedCiIds: splitIds(edit.affectedCiIds),
                          }),
                        () => setEdit(null),
                      )
                    }
                  >
                    Save
                  </Button>
                  <Button onClick={() => setEdit(null)}>Cancel</Button>
                </Stack>
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
