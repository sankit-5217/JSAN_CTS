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

interface BcpPlan {
  id: string;
  name: string;
  siteId: string | null;
  serviceName: string | null;
  rtoMinutes: number;
  rpoMinutes: number;
  lastTestedAt: string | null;
  nextTestDueAt: string | null;
  isActive: boolean;
  readiness: string;
}

const READINESS_COLOR: Record<string, "default" | "warning" | "success"> = {
  UNTESTED: "default",
  DUE: "warning",
  READY: "success",
};

/**
 * Business-continuity plans (spec §10.15). A plan covers one site XOR one
 * named service. "Readiness" (untested / test overdue / ready) is derived
 * from the test dates. Tests are logged on the detail page.
 */
export function BcpPlansPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [plans, setPlans] = useState<BcpPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const view = searchParams.get("view") ?? "";
  const setView = (v: string) => {
    const next = new URLSearchParams(searchParams);
    if (v) next.set("view", v);
    else next.delete("view");
    setSearchParams(next, { replace: true });
  };

  const load = () => {
    setError(null);
    const params = new URLSearchParams();
    if (view) params.set("view", view);
    apiGet<BcpPlan[]>(`/bcp-plans?${params.toString()}`)
      .then(setPlans)
      .catch((err: Error) => setError(err.message));
  };
  useEffect(load, [view]);

  const [form, setForm] = useState({
    name: "",
    scopeKind: "site",
    siteId: "",
    serviceName: "",
    recoveryStrategy: "",
    alternateSite: "",
    rtoMinutes: "240",
    rpoMinutes: "15",
    nextTestDueAt: "",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const create = async () => {
    setActionError(null);
    try {
      await apiPost("/bcp-plans", {
        name: form.name,
        siteId: form.scopeKind === "site" ? form.siteId : undefined,
        serviceName: form.scopeKind === "service" ? form.serviceName : undefined,
        recoveryStrategy: form.recoveryStrategy,
        alternateSite: form.alternateSite || undefined,
        rtoMinutes: Number(form.rtoMinutes),
        rpoMinutes: Number(form.rpoMinutes),
        nextTestDueAt: form.nextTestDueAt
          ? new Date(form.nextTestDueAt).toISOString()
          : undefined,
      });
      setForm((f) => ({
        ...f,
        name: "",
        siteId: "",
        serviceName: "",
        recoveryStrategy: "",
        alternateSite: "",
        nextTestDueAt: "",
      }));
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const scopeOk =
    (form.scopeKind === "site" && form.siteId) ||
    (form.scopeKind === "service" && form.serviceName);

  return (
    <>
      <Link component={RouterLink} to="/risks" sx={{ display: "inline-block", mb: 2 }}>
        ← Risk register
      </Link>
      <Typography variant="h4" gutterBottom>
        BCP plans
      </Typography>

      {error && (
        <MuiAlert severity="error" sx={{ mb: 2 }}>
          Could not load plans: {error}
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
              New plan
            </Typography>
            <Stack spacing={2}>
              <TextField
                size="small"
                label="Name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
              <TextField
                select
                size="small"
                label="Covers"
                value={form.scopeKind}
                onChange={(e) => set("scopeKind", e.target.value)}
              >
                <MenuItem value="site">A site</MenuItem>
                <MenuItem value="service">A named service</MenuItem>
              </TextField>
              {form.scopeKind === "site" ? (
                <TextField
                  size="small"
                  label="Site id"
                  value={form.siteId}
                  onChange={(e) => set("siteId", e.target.value)}
                />
              ) : (
                <TextField
                  size="small"
                  label="Service name"
                  value={form.serviceName}
                  onChange={(e) => set("serviceName", e.target.value)}
                />
              )}
              <TextField
                size="small"
                multiline
                label="Recovery strategy"
                value={form.recoveryStrategy}
                onChange={(e) => set("recoveryStrategy", e.target.value)}
              />
              <TextField
                size="small"
                label="Alternate site (optional)"
                value={form.alternateSite}
                onChange={(e) => set("alternateSite", e.target.value)}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  size="small"
                  type="number"
                  label="RTO (min)"
                  value={form.rtoMinutes}
                  onChange={(e) => set("rtoMinutes", e.target.value)}
                />
                <TextField
                  size="small"
                  type="number"
                  label="RPO (min)"
                  value={form.rpoMinutes}
                  onChange={(e) => set("rpoMinutes", e.target.value)}
                />
              </Stack>
              <TextField
                type="date"
                size="small"
                label="Next test due (optional)"
                InputLabelProps={{ shrink: true }}
                value={form.nextTestDueAt}
                onChange={(e) => set("nextTestDueAt", e.target.value)}
              />
              <Button
                variant="contained"
                disabled={!form.name || !form.recoveryStrategy || !scopeOk}
                onClick={create}
              >
                Create plan
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={7}>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField
              select
              size="small"
              label="View"
              value={view}
              onChange={(e) => setView(e.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="due">Test overdue</MenuItem>
            </TextField>
          </Stack>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Covers</TableCell>
                  <TableCell>RTO / RPO</TableCell>
                  <TableCell>Readiness</TableCell>
                  <TableCell>Last tested</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {plans.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link component={RouterLink} to={`/bcp-plans/${p.id}`}>
                        {p.name}
                      </Link>
                      {!p.isActive && (
                        <Chip size="small" label="retired" sx={{ ml: 0.5 }} />
                      )}
                    </TableCell>
                    <TableCell>{p.siteId ? `site ${p.siteId.slice(0, 8)}` : p.serviceName}</TableCell>
                    <TableCell>
                      {p.rtoMinutes}m / {p.rpoMinutes}m
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={p.readiness}
                        color={READINESS_COLOR[p.readiness] ?? "default"}
                      />
                    </TableCell>
                    <TableCell>
                      {p.lastTestedAt ? new Date(p.lastTestedAt).toLocaleDateString() : "never"}
                    </TableCell>
                  </TableRow>
                ))}
                {plans.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary">
                        No BCP plans yet.
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
