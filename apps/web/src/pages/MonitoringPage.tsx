import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";
import { apiGet } from "../api/client";

type Window7to90 = 7 | 30 | 90;
type AlertSeverity = "CRITICAL" | "HIGH" | "WARNING" | "INFO";
type AlertState = "OPEN" | "ACKNOWLEDGED" | "RECOVERED";

interface AlertSeverityCount {
  severity: AlertSeverity;
  count: number;
}

interface AlertStateCount {
  state: AlertState;
  count: number;
}

interface DailyAlertVolumePoint {
  date: string;
  bySeverity: Record<AlertSeverity, number>;
  total: number;
}

interface AlertInsightsReport {
  windowDays: Window7to90;
  from: string;
  to: string;
  totalNewAlerts: number;
  bySeverity: AlertSeverityCount[];
  byState: AlertStateCount[];
  daily: DailyAlertVolumePoint[];
}

const WINDOW_OPTIONS: { value: Window7to90; label: string }[] = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

// Same reserved status meaning as the rest of the app (AlertsPage's severity
// chips, Command Center's HEALTH_COLOR) — a status color never follows a
// generic categorical cycle, and is always paired with a label here, never
// shown as color alone.
const SEVERITY_ORDER: AlertSeverity[] = ["CRITICAL", "HIGH", "WARNING", "INFO"];
const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  CRITICAL: "#d32f2f",
  HIGH: "#ed6c02",
  WARNING: "#0288d1",
  INFO: "#757575",
};

const STATE_ORDER: AlertState[] = ["OPEN", "ACKNOWLEDGED", "RECOVERED"];
const STATE_COLOR: Record<AlertState, string> = {
  OPEN: "#ed6c02",
  ACKNOWLEDGED: "#0288d1",
  RECOVERED: "#2e7d32",
};
const STATE_LABEL: Record<AlertState, string> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  RECOVERED: "Recovered",
};

/** A single headline number, not a chart — per-severity/state counts are "a
 * handful of headline numbers," which reads better as stat tiles than as a
 * pie/bar chart competing for the same 4-7 categories. */
function StatusTile({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: color,
            flexShrink: 0,
          }}
        />
        <Box>
          <Typography variant="subtitle2" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h5">{value}</Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

/**
 * Monitoring & alert insights (spec §10.16) — the severity/state mix and
 * daily volume of alerts ingested from Zabbix/Prometheus/Redfish/SNMP,
 * scoped to one rolling window so every number on the page describes the
 * same slice of alerts (interaction rule: filters scope everything below
 * them). Fed by GET /reports/alert-insights.
 */
export function MonitoringPage() {
  const [windowDays, setWindowDays] = useState<Window7to90>(30);
  const [report, setReport] = useState<AlertInsightsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReport(null);
    setError(null);
    apiGet<AlertInsightsReport>(`/reports/alert-insights?windowDays=${windowDays}`)
      .then(setReport)
      .catch((err: Error) => setError(err.message));
  }, [windowDays]);

  return (
    <>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ sm: "center" }}
        spacing={1}
        sx={{ mb: 3 }}
      >
        <Typography variant="h4">Monitoring</Typography>
        <ToggleButtonGroup
          value={windowDays}
          exclusive
          size="small"
          onChange={(_e, value: Window7to90 | null) => {
            if (value !== null) setWindowDays(value);
          }}
        >
          {WINDOW_OPTIONS.map((opt) => (
            <ToggleButton key={opt.value} value={opt.value}>
              {opt.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load alert insights: {error}. Is `pnpm dev:api` running?
        </Alert>
      )}

      {!report && !error && <Typography color="text.secondary">Loading...</Typography>}

      {report && (
        <>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Alerts first seen,{" "}
            {WINDOW_OPTIONS.find((o) => o.value === windowDays)?.label.toLowerCase()} (
            {report.totalNewAlerts} total)
          </Typography>

          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
            By severity
          </Typography>
          <Grid container spacing={2} sx={{ mt: 0.25, mb: 2.5 }}>
            {SEVERITY_ORDER.map((severity) => (
              <Grid item xs={6} sm={3} key={severity}>
                <StatusTile
                  color={SEVERITY_COLOR[severity]}
                  label={severity}
                  value={report.bySeverity.find((s) => s.severity === severity)?.count ?? 0}
                />
              </Grid>
            ))}
          </Grid>

          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
            By state
          </Typography>
          <Grid container spacing={2} sx={{ mt: 0.25, mb: 3 }}>
            {STATE_ORDER.map((state) => (
              <Grid item xs={12} sm={4} key={state}>
                <StatusTile
                  color={STATE_COLOR[state]}
                  label={STATE_LABEL[state]}
                  value={report.byState.find((s) => s.state === state)?.count ?? 0}
                />
              </Grid>
            ))}
          </Grid>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                New alerts per day, by severity
              </Typography>
              {report.daily.every((d) => d.total === 0) ? (
                <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
                  No alerts were first seen in this window.
                </Typography>
              ) : (
                <BarChart
                  xAxis={[
                    {
                      scaleType: "band",
                      data: report.daily.map((d) => d.date.slice(5)), // MM-DD
                    },
                  ]}
                  series={SEVERITY_ORDER.map((severity) => ({
                    label: severity,
                    stack: "total",
                    color: SEVERITY_COLOR[severity],
                    data: report.daily.map((d) => d.bySeverity[severity]),
                  }))}
                  height={280}
                />
              )}
            </CardContent>
          </Card>

          {/* Table view of the same data, per the accessibility rule that a
              chart's numbers stay reachable without hovering. */}
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Daily breakdown
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      {SEVERITY_ORDER.map((severity) => (
                        <TableCell key={severity} align="right">
                          {severity}
                        </TableCell>
                      ))}
                      <TableCell align="right">Total</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.daily.map((day) => (
                      <TableRow key={day.date}>
                        <TableCell>{day.date}</TableCell>
                        {SEVERITY_ORDER.map((severity) => (
                          <TableCell key={severity} align="right">
                            {day.bySeverity[severity]}
                          </TableCell>
                        ))}
                        <TableCell align="right">{day.total}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
