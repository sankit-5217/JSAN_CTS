import { useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Alert as MuiAlert,
  Button,
  Chip,
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
import { apiGet } from "../api/client";

// Literal unions mirroring the Prisma enums — see IncidentsPage.tsx for why
// these aren't imported from shared-types.
const ALERT_STATES = ["OPEN", "ACKNOWLEDGED", "RECOVERED"];
const ALERT_SEVERITIES = ["CRITICAL", "HIGH", "WARNING", "INFO"];

interface AlertRow {
  id: string;
  source: string;
  siteId: string | null;
  ciId: string | null;
  alertType: string;
  severity: string;
  state: string;
  fingerprint: string;
  lastSeenAt: string;
  correlatedIncidentId: string | null;
}

interface Ci {
  id: string;
  ciCode: string;
}
interface Paginated<T> {
  items: T[];
}

const SEVERITY_COLOR: Record<string, "error" | "warning" | "info" | "default"> = {
  CRITICAL: "error",
  HIGH: "warning",
  WARNING: "info",
  INFO: "default",
};

/**
 * Alert queue (spec §10.9) — a filtered, read-only list. Alerts are
 * machine-driven (ingested via /alerts/sources/*), so there is no create
 * form; state/severity/ciCode come from the querystring so other views can
 * deep-link. "Alert rules" opens the ingestion-policy editor.
 */
export function AlertsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [cisById, setCisById] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const state = searchParams.get("state") ?? "";
  const severity = searchParams.get("severity") ?? "";
  const ciCode = searchParams.get("ciCode") ?? "";

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    apiGet<Paginated<Ci>>("/cis?limit=200")
      .then((cis) => setCisById(Object.fromEntries(cis.items.map((c) => [c.id, c.ciCode]))))
      .catch(() => undefined); // non-fatal — falls back to raw ids
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (state) params.set("state", state);
    if (severity) params.set("severity", severity);
    if (ciCode) params.set("ciCode", ciCode);
    apiGet<AlertRow[]>(`/alerts?${params.toString()}`)
      .then(setAlerts)
      .catch((err: Error) => setError(err.message));
  }, [state, severity, ciCode]);

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h4">Alerts</Typography>
        <Button variant="outlined" component={RouterLink} to="/alert-rules">
          Alert rules
        </Button>
      </Stack>

      <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
        <TextField
          select
          size="small"
          label="State"
          value={state}
          onChange={(e) => setFilter("state", e.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">Any</MenuItem>
          {ALERT_STATES.map((s) => (
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
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">Any</MenuItem>
          {ALERT_SEVERITIES.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="CI code"
          value={ciCode}
          onChange={(e) => setFilter("ciCode", e.target.value)}
        />
      </Stack>

      {error && (
        <MuiAlert severity="error" sx={{ mb: 2 }}>
          Could not load alerts: {error}
        </MuiAlert>
      )}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Severity</TableCell>
              <TableCell>State</TableCell>
              <TableCell>CI</TableCell>
              <TableCell>Last seen</TableCell>
              <TableCell>Incident</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {alerts.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Link component={RouterLink} to={`/alerts/${a.id}`}>
                    {a.alertType}
                  </Link>
                </TableCell>
                <TableCell>{a.source}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={a.severity}
                    color={SEVERITY_COLOR[a.severity] ?? "default"}
                  />
                </TableCell>
                <TableCell>{a.state}</TableCell>
                <TableCell>{a.ciId ? (cisById[a.ciId] ?? a.ciId) : "—"}</TableCell>
                <TableCell>{new Date(a.lastSeenAt).toLocaleString()}</TableCell>
                <TableCell>
                  {a.correlatedIncidentId ? (
                    <Link component={RouterLink} to={`/incidents/${a.correlatedIncidentId}`}>
                      linked
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
            {alerts.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary">
                    No alerts match these filters.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
