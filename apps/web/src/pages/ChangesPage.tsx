import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Alert as MuiAlert,
  Button,
  Chip,
  Grid,
  Link,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { apiGet, apiPost } from "../api/client";

const CHANGE_TYPES = ["STANDARD", "NORMAL", "EMERGENCY"];
const CHANGE_STATUSES = [
  "PENDING_APPROVAL",
  "SCHEDULED",
  "IN_PROGRESS",
  "PENDING_REVIEW",
  "COMPLETED",
];

interface Change {
  id: string;
  changeType: string;
  reason: string;
  windowStart: string;
  windowEnd: string;
  approverId: string | null;
  outcome: string | null;
  affectedCiIds: string[];
  status: string;
  pirOverdue: boolean;
}

const STATUS_COLOR: Record<string, "default" | "info" | "warning" | "success"> = {
  PENDING_APPROVAL: "warning",
  SCHEDULED: "info",
  IN_PROGRESS: "info",
  PENDING_REVIEW: "warning",
  COMPLETED: "success",
};

function splitIds(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Change management (spec §10.6): the change register with a create form and a
 * live "in maintenance now" panel — the same feed the alert pipeline reads to
 * suppress expected noise. Status is derived server-side (no status column);
 * approve / edit / outcome live on the detail page.
 */
export function ChangesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [changes, setChanges] = useState<Change[]>([]);
  const [activeWindows, setActiveWindows] = useState<Change[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const changeType = searchParams.get("changeType") ?? "";
  const status = searchParams.get("status") ?? "";
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const refetch = useCallback(() => {
    setError(null);
    const params = new URLSearchParams();
    if (changeType) params.set("changeType", changeType);
    if (status) params.set("status", status);
    Promise.all([
      apiGet<Change[]>(`/changes?${params.toString()}`),
      apiGet<Change[]>("/changes/maintenance/active"),
    ])
      .then(([list, active]) => {
        setChanges(list);
        setActiveWindows(active);
      })
      .catch((err: Error) => setError(err.message));
  }, [changeType, status]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const [form, setForm] = useState({
    changeType: "NORMAL",
    reason: "",
    implementationPlan: "",
    rollbackPlan: "",
    risk: "",
    windowStart: "",
    windowEnd: "",
    affectedCiIds: "",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const create = async () => {
    setActionError(null);
    try {
      await apiPost("/changes", {
        changeType: form.changeType,
        reason: form.reason,
        implementationPlan: form.implementationPlan,
        rollbackPlan: form.rollbackPlan,
        risk: form.risk,
        windowStart: new Date(form.windowStart).toISOString(),
        windowEnd: new Date(form.windowEnd).toISOString(),
        affectedCiIds: splitIds(form.affectedCiIds),
      });
      setForm((f) => ({
        ...f,
        reason: "",
        implementationPlan: "",
        rollbackPlan: "",
        risk: "",
        windowStart: "",
        windowEnd: "",
        affectedCiIds: "",
      }));
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const windowSet = Boolean(form.windowStart && form.windowEnd);

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Changes
      </Typography>

      {activeWindows.length > 0 && (
        <MuiAlert severity="info" sx={{ mb: 2 }}>
          In maintenance now:{" "}
          {activeWindows.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ", "}
              <Link component={RouterLink} to={`/changes/${c.id}`}>
                {c.reason.slice(0, 40)}
              </Link>
            </span>
          ))}
        </MuiAlert>
      )}
      {error && (
        <MuiAlert severity="error" sx={{ mb: 2 }}>
          Could not load changes: {error}
        </MuiAlert>
      )}
      {actionError && (
        <MuiAlert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </MuiAlert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Raise a change
            </Typography>
            <Stack spacing={2}>
              <TextField
                select
                size="small"
                label="Type"
                value={form.changeType}
                onChange={(e) => set("changeType", e.target.value)}
              >
                {CHANGE_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="Reason"
                value={form.reason}
                onChange={(e) => set("reason", e.target.value)}
              />
              <TextField
                size="small"
                multiline
                label="Implementation plan"
                value={form.implementationPlan}
                onChange={(e) => set("implementationPlan", e.target.value)}
              />
              <TextField
                size="small"
                multiline
                label="Rollback plan"
                value={form.rollbackPlan}
                onChange={(e) => set("rollbackPlan", e.target.value)}
              />
              <TextField
                size="small"
                label="Risk"
                value={form.risk}
                onChange={(e) => set("risk", e.target.value)}
              />
              <TextField
                type="datetime-local"
                size="small"
                label="Window start"
                InputLabelProps={{ shrink: true }}
                value={form.windowStart}
                onChange={(e) => set("windowStart", e.target.value)}
              />
              <TextField
                type="datetime-local"
                size="small"
                label="Window end"
                InputLabelProps={{ shrink: true }}
                value={form.windowEnd}
                onChange={(e) => set("windowEnd", e.target.value)}
              />
              <TextField
                size="small"
                multiline
                label="Affected CI ids (space/comma separated; blank = site-wide)"
                value={form.affectedCiIds}
                onChange={(e) => set("affectedCiIds", e.target.value)}
              />
              <Button variant="contained" disabled={!form.reason || !windowSet} onClick={create}>
                Raise change
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={7}>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField
              select
              size="small"
              label="Type"
              value={changeType}
              onChange={(e) => setFilter("changeType", e.target.value)}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">Any</MenuItem>
              {CHANGE_TYPES.map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Status"
              value={status}
              onChange={(e) => setFilter("status", e.target.value)}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">Any</MenuItem>
              {CHANGE_STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell>Reason</TableCell>
                  <TableCell>Window</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {changes.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.changeType}</TableCell>
                    <TableCell>
                      <Link component={RouterLink} to={`/changes/${c.id}`}>
                        {c.reason}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {new Date(c.windowStart).toLocaleString()} →{" "}
                      {new Date(c.windowEnd).toLocaleTimeString()}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={c.status}
                        color={STATUS_COLOR[c.status] ?? "default"}
                      />
                      {c.pirOverdue && (
                        <Chip size="small" color="error" label="PIR overdue" sx={{ ml: 0.5 }} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {changes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary">
                        No changes match these filters.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>
      </Grid>
    </>
  );
}
