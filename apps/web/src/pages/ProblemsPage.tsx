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

const PROBLEM_STATUSES = ["OPEN", "INVESTIGATING", "KNOWN_ERROR", "RESOLVED", "CLOSED"];
const PRIORITIES = ["P1", "P2", "P3", "P4"];

interface Problem {
  id: string;
  problemNo: string;
  title: string;
  status: string;
  priority: string | null;
  ownerUserId: string | null;
  dueDate: string | null;
}

const STATUS_COLOR: Record<string, "default" | "info" | "warning" | "success"> = {
  OPEN: "warning",
  INVESTIGATING: "info",
  KNOWN_ERROR: "default",
  RESOLVED: "success",
  CLOSED: "default",
};

/**
 * Problem / RCA register (spec §10.5). A problem tracks a recurring or major
 * root cause across possibly-many incidents; status moves through
 * POST /problems/:id/transition on the detail page, never here.
 */
export function ProblemsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [problems, setProblems] = useState<Problem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const status = searchParams.get("status") ?? "";
  const ownerUserId = searchParams.get("ownerUserId") ?? "";
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
    if (ownerUserId) params.set("ownerUserId", ownerUserId);
    apiGet<Problem[]>(`/problems?${params.toString()}`)
      .then(setProblems)
      .catch((err: Error) => setError(err.message));
  };
  useEffect(load, [status, ownerUserId]);

  const [form, setForm] = useState({
    title: "",
    symptoms: "",
    priority: "",
    knownError: "",
    ownerUserId: "",
    dueDate: "",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const create = async () => {
    setActionError(null);
    try {
      await apiPost("/problems", {
        title: form.title,
        symptoms: form.symptoms,
        priority: form.priority || undefined,
        knownError: form.knownError || undefined,
        ownerUserId: form.ownerUserId || undefined,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
      });
      setForm({
        title: "",
        symptoms: "",
        priority: "",
        knownError: "",
        ownerUserId: "",
        dueDate: "",
      });
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Problems / RCA
      </Typography>

      {error && (
        <MuiAlert severity="error" sx={{ mb: 2 }}>
          Could not load problems: {error}
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
              Open a problem
            </Typography>
            <Stack spacing={2}>
              <TextField
                size="small"
                label="Title"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
              />
              <TextField
                size="small"
                multiline
                label="Symptoms"
                value={form.symptoms}
                onChange={(e) => set("symptoms", e.target.value)}
              />
              <TextField
                select
                size="small"
                label="Priority (optional)"
                value={form.priority}
                onChange={(e) => set("priority", e.target.value)}
              >
                <MenuItem value="">Unset</MenuItem>
                {PRIORITIES.map((p) => (
                  <MenuItem key={p} value={p}>
                    {p}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                multiline
                label="Known error / workaround (optional)"
                value={form.knownError}
                onChange={(e) => set("knownError", e.target.value)}
              />
              <TextField
                size="small"
                label="Owner user id (optional)"
                value={form.ownerUserId}
                onChange={(e) => set("ownerUserId", e.target.value)}
              />
              <TextField
                type="date"
                size="small"
                label="Due date (optional)"
                InputLabelProps={{ shrink: true }}
                value={form.dueDate}
                onChange={(e) => set("dueDate", e.target.value)}
              />
              <Button
                variant="contained"
                disabled={form.title.length < 3 || form.symptoms.length < 3}
                onClick={create}
              >
                Open problem
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
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">Any</MenuItem>
              {PROBLEM_STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Owner user id"
              value={ownerUserId}
              onChange={(e) => setFilter("ownerUserId", e.target.value)}
              sx={{ minWidth: 200 }}
            />
          </Stack>

          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Problem</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Priority</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Due</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {problems.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link component={RouterLink} to={`/problems/${p.id}`}>
                        {p.problemNo}
                      </Link>
                    </TableCell>
                    <TableCell>{p.title}</TableCell>
                    <TableCell>{p.priority ?? "—"}</TableCell>
                    <TableCell>
                      <Chip size="small" label={p.status} color={STATUS_COLOR[p.status] ?? "default"} />
                    </TableCell>
                    <TableCell>
                      {p.dueDate ? new Date(p.dueDate).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {problems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary">
                        No problems match these filters.
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
