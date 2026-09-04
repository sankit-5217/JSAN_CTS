import { useEffect, useState } from "react";
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

const RISK_STATUSES = ["OPEN", "MITIGATING", "ACCEPTED", "CLOSED"];
const RISK_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

interface Risk {
  id: string;
  description: string;
  likelihood: number;
  impact: number;
  score: number;
  status: string;
  dueDate: string | null;
  severity: string;
  overdue: boolean;
}

const SEVERITY_COLOR: Record<string, "default" | "info" | "warning" | "error"> = {
  LOW: "default",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "error",
};

/**
 * Risk register (spec §10.15). `score` = likelihood × impact is computed
 * server-side; `severity` / `overdue` are derived. Status moves only through
 * POST /risks/:id/status on the detail page.
 */
export function RisksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [risks, setRisks] = useState<Risk[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const status = searchParams.get("status") ?? "";
  const severity = searchParams.get("severity") ?? "";
  const view = searchParams.get("view") ?? "";
  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(searchParams);
    if (v) next.set(k, v);
    else next.delete(k);
    setSearchParams(next, { replace: true });
  };

  const load = () => {
    setError(null);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (severity) params.set("severity", severity);
    if (view) params.set("view", view);
    apiGet<Risk[]>(`/risks?${params.toString()}`)
      .then(setRisks)
      .catch((err: Error) => setError(err.message));
  };
  useEffect(load, [status, severity, view]);

  const [form, setForm] = useState({
    description: "",
    likelihood: "3",
    impact: "3",
    mitigation: "",
    ownerId: "",
    siteId: "",
    dueDate: "",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const create = async () => {
    setActionError(null);
    try {
      await apiPost("/risks", {
        description: form.description,
        likelihood: Number(form.likelihood),
        impact: Number(form.impact),
        mitigation: form.mitigation || undefined,
        ownerId: form.ownerId || undefined,
        siteId: form.siteId || undefined,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
      });
      setForm((f) => ({
        ...f,
        description: "",
        mitigation: "",
        ownerId: "",
        siteId: "",
        dueDate: "",
      }));
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h4">Risk register</Typography>
        <Button variant="outlined" component={RouterLink} to="/bcp-plans">
          BCP plans
        </Button>
      </Stack>

      {error && (
        <MuiAlert severity="error" sx={{ mb: 2 }}>
          Could not load risks: {error}
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
              Register a risk
            </Typography>
            <Stack spacing={2}>
              <TextField
                size="small"
                multiline
                label="Description"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  size="small"
                  type="number"
                  label="Likelihood (1-5)"
                  value={form.likelihood}
                  onChange={(e) => set("likelihood", e.target.value)}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Impact (1-5)"
                  value={form.impact}
                  onChange={(e) => set("impact", e.target.value)}
                />
              </Stack>
              <TextField
                size="small"
                multiline
                label="Mitigation (optional)"
                value={form.mitigation}
                onChange={(e) => set("mitigation", e.target.value)}
              />
              <TextField
                size="small"
                label="Owner user id (optional)"
                value={form.ownerId}
                onChange={(e) => set("ownerId", e.target.value)}
              />
              <TextField
                size="small"
                label="Site id (optional)"
                value={form.siteId}
                onChange={(e) => set("siteId", e.target.value)}
              />
              <TextField
                type="date"
                size="small"
                label="Due date (optional)"
                InputLabelProps={{ shrink: true }}
                value={form.dueDate}
                onChange={(e) => set("dueDate", e.target.value)}
              />
              <Button variant="contained" disabled={form.description.length < 3} onClick={create}>
                Register risk
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={7}>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField
              select
              size="small"
              label="Status"
              value={status}
              onChange={(e) => setFilter("status", e.target.value)}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">Any</MenuItem>
              {RISK_STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Severity"
              value={severity}
              onChange={(e) => setFilter("severity", e.target.value)}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">Any</MenuItem>
              {RISK_SEVERITIES.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="View"
              value={view}
              onChange={(e) => setFilter("view", e.target.value)}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="overdue">Overdue</MenuItem>
            </TextField>
          </Stack>

          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Description</TableCell>
                  <TableCell>Score</TableCell>
                  <TableCell>Severity</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Due</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {risks.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link component={RouterLink} to={`/risks/${r.id}`}>
                        {r.description}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {r.likelihood}×{r.impact}={r.score}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={r.severity}
                        color={SEVERITY_COLOR[r.severity] ?? "default"}
                      />
                    </TableCell>
                    <TableCell>{r.status}</TableCell>
                    <TableCell>
                      {r.dueDate ? new Date(r.dueDate).toLocaleDateString() : "—"}
                      {r.overdue && (
                        <Chip size="small" color="error" label="overdue" sx={{ ml: 0.5 }} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {risks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary">
                        No risks match these filters.
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
