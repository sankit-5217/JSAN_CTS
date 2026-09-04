import { useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert as MuiAlert,
  Box,
  Card,
  CardContent,
  Chip,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { apiGet } from "../api/client";

interface AlertRecord {
  id: string;
  externalEventId: string;
  source: string;
  siteId: string | null;
  ciId: string | null;
  alertType: string;
  severity: string;
  state: string;
  fingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  rawReference: string | null;
  correlatedIncidentId: string | null;
}

const SEVERITY_COLOR: Record<string, "error" | "warning" | "info" | "default"> = {
  CRITICAL: "error",
  HIGH: "warning",
  WARNING: "info",
  INFO: "default",
};

/**
 * Read-only alert record (spec §10.9). Alerts are never edited from the
 * portal — the pipeline dedupes / reduces state on ingest. The one live
 * link out is the correlated incident, when the ingest attached one.
 */
export function AlertDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [alert, setAlert] = useState<AlertRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    apiGet<AlertRecord>(`/alerts/${id}`)
      .then(setAlert)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  if (error) {
    return (
      <MuiAlert severity="error">
        Could not load alert {id}: {error}
      </MuiAlert>
    );
  }
  if (!alert) {
    return <Typography color="text.secondary">Loading...</Typography>;
  }

  const row = (label: string, value: React.ReactNode) => (
    <Typography variant="body2" color="text.secondary">
      {label}: {value}
    </Typography>
  );

  return (
    <Box>
      <Link component={RouterLink} to="/alerts" sx={{ display: "inline-block", mb: 2 }}>
        ← All alerts
      </Link>
      <Card>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h5">{alert.alertType}</Typography>
            <Chip
              size="small"
              label={alert.severity}
              color={SEVERITY_COLOR[alert.severity] ?? "default"}
            />
            <Chip size="small" label={alert.state} />
          </Stack>
          {row("Source", `${alert.source} · ${alert.externalEventId}`)}
          {row("Site", alert.siteId ?? "unresolved")}
          {row("CI", alert.ciId ?? "unresolved")}
          {row("Fingerprint", <code>{alert.fingerprint}</code>)}
          {row("First seen", new Date(alert.firstSeenAt).toLocaleString())}
          {row("Last seen", new Date(alert.lastSeenAt).toLocaleString())}
          {row("Raw reference", alert.rawReference ?? "—")}
          {row(
            "Correlated incident",
            alert.correlatedIncidentId ? (
              <Link component={RouterLink} to={`/incidents/${alert.correlatedIncidentId}`}>
                {alert.correlatedIncidentId}
              </Link>
            ) : (
              "none"
            ),
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
