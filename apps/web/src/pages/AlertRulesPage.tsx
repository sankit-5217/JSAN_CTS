import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert as MuiAlert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
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
import { apiGet, apiPatch, apiPost } from "../api/client";

const ALERT_SEVERITIES = ["CRITICAL", "HIGH", "WARNING", "INFO"];

interface AlertRule {
  id: string;
  name: string;
  siteId: string | null;
  alertType: string | null;
  flappingThreshold: number;
  flappingWindowMinutes: number;
  pagingSeverities: string[];
  autoCorrelateIncidents: boolean;
  suppressAutoTicketDuringMaintenance: boolean;
  isActive: boolean;
  updatedAt: string;
}

const BLANK = {
  name: "",
  siteId: "",
  alertType: "",
  flappingThreshold: "3",
  flappingWindowMinutes: "30",
  pagingSeverities: ["CRITICAL"] as string[],
  autoCorrelateIncidents: true,
  suppressAutoTicketDuringMaintenance: true,
};

function scopeLabel(r: AlertRule): string {
  const parts = [r.siteId && `site ${r.siteId.slice(0, 8)}`, r.alertType && `type ${r.alertType}`];
  const kept = parts.filter(Boolean);
  return kept.length ? kept.join(" · ") : "global";
}

/**
 * Alert ingestion policy editor (spec §10.10, "config over hard-code").
 * `alert_rules` rows tune flapping detection, which severities page the NOC,
 * auto-correlation and maintenance suppression; a rule may be scoped to a
 * site and/or alert type, and ingest() applies the most specific match. One
 * form handles create and edit; the ingest path picks up a change within ~30s.
 */
export function AlertRulesPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setError(null);
    apiGet<AlertRule[]>("/alert-rules")
      .then(setRules)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const startEdit = (r: AlertRule) => {
    setEditingId(r.id);
    setForm({
      name: r.name,
      siteId: r.siteId ?? "",
      alertType: r.alertType ?? "",
      flappingThreshold: String(r.flappingThreshold),
      flappingWindowMinutes: String(r.flappingWindowMinutes),
      pagingSeverities: r.pagingSeverities,
      autoCorrelateIncidents: r.autoCorrelateIncidents,
      suppressAutoTicketDuringMaintenance: r.suppressAutoTicketDuringMaintenance,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ ...BLANK });
  };

  const submit = async () => {
    setActionError(null);
    const body = {
      name: form.name,
      siteId: form.siteId || (editingId ? null : undefined),
      alertType: form.alertType || (editingId ? null : undefined),
      flappingThreshold: Number(form.flappingThreshold),
      flappingWindowMinutes: Number(form.flappingWindowMinutes),
      pagingSeverities: form.pagingSeverities,
      autoCorrelateIncidents: form.autoCorrelateIncidents,
      suppressAutoTicketDuringMaintenance: form.suppressAutoTicketDuringMaintenance,
    };
    try {
      if (editingId) await apiPatch(`/alert-rules/${editingId}`, body);
      else await apiPost("/alert-rules", body);
      cancelEdit();
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleActive = async (r: AlertRule) => {
    setActionError(null);
    try {
      await apiPatch(`/alert-rules/${r.id}`, { isActive: !r.isActive });
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <Link component={RouterLink} to="/alerts" sx={{ display: "inline-block", mb: 2 }}>
        ← Alerts
      </Link>
      <Typography variant="h4" gutterBottom>
        Alert ingestion rules
      </Typography>

      {error && (
        <MuiAlert severity="error" sx={{ mb: 2 }}>
          Could not load rules: {error}
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
              {editingId ? "Edit rule" : "New rule"}
            </Typography>
            <Stack spacing={2}>
              <TextField
                size="small"
                label="Name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
              <TextField
                size="small"
                label="Site ID (blank = all sites)"
                value={form.siteId}
                onChange={(e) => set("siteId", e.target.value)}
              />
              <TextField
                size="small"
                label="Alert type (blank = all types)"
                value={form.alertType}
                onChange={(e) => set("alertType", e.target.value)}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  size="small"
                  type="number"
                  label="Flapping threshold"
                  value={form.flappingThreshold}
                  onChange={(e) => set("flappingThreshold", e.target.value)}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Window (min)"
                  value={form.flappingWindowMinutes}
                  onChange={(e) => set("flappingWindowMinutes", e.target.value)}
                />
              </Stack>
              <TextField
                select
                size="small"
                label="Paging severities"
                value={form.pagingSeverities}
                onChange={(e) =>
                  set(
                    "pagingSeverities",
                    typeof e.target.value === "string"
                      ? e.target.value.split(",")
                      : (e.target.value as string[]),
                  )
                }
                SelectProps={{ multiple: true }}
              >
                {ALERT_SEVERITIES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </TextField>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.autoCorrelateIncidents}
                    onChange={(e) => set("autoCorrelateIncidents", e.target.checked)}
                  />
                }
                label="Auto-correlate to open incidents"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.suppressAutoTicketDuringMaintenance}
                    onChange={(e) => set("suppressAutoTicketDuringMaintenance", e.target.checked)}
                  />
                }
                label="Suppress auto-ticketing during maintenance"
              />
              <Stack direction="row" spacing={1}>
                <Button variant="contained" disabled={form.name.length < 1} onClick={submit}>
                  {editingId ? "Save" : "Create"}
                </Button>
                {editingId && <Button onClick={cancelEdit}>Cancel</Button>}
              </Stack>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={7}>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Scope</TableCell>
                  <TableCell>Flapping</TableCell>
                  <TableCell>Paging</TableCell>
                  <TableCell>Correlate</TableCell>
                  <TableCell>Maint.</TableCell>
                  <TableCell>Active</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id} selected={r.id === editingId}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{scopeLabel(r)}</TableCell>
                    <TableCell>
                      {r.flappingThreshold} / {r.flappingWindowMinutes}m
                    </TableCell>
                    <TableCell>{r.pagingSeverities.join(", ") || "—"}</TableCell>
                    <TableCell>{r.autoCorrelateIncidents ? "yes" : "no"}</TableCell>
                    <TableCell>{r.suppressAutoTicketDuringMaintenance ? "suppress" : "label"}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={r.isActive ? "active" : "off"}
                        color={r.isActive ? "success" : "default"}
                        onClick={() => toggleActive(r)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button size="small" onClick={() => startEdit(r)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {rules.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Typography variant="body2" color="text.secondary">
                        No rules yet — ingestion uses the built-in defaults.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              ingest() applies the most specific active rule: site + type &gt; site &gt; type &gt;
              global.
            </Typography>
          </Box>
        </Grid>
      </Grid>
    </>
  );
}
