import { useEffect, useState } from "react";
import {
  Alert,
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
import { LineChart } from "@mui/x-charts/LineChart";
import { apiGet } from "../api/client";

type ResponseTrendWindow = 7 | 30 | 90;

interface DailyResponseTrendPoint {
  date: string;
  incidentsCreated: number;
  avgAckMinutes: number | null;
  avgRestoreMinutes: number | null;
}

interface PriorityResponseSummary {
  priority: "P1" | "P2" | "P3" | "P4";
  incidentCount: number;
  avgAckMinutes: number | null;
  avgRestoreMinutes: number | null;
}

interface ResponseTrendReport {
  windowDays: ResponseTrendWindow;
  from: string;
  to: string;
  overall: {
    incidentCount: number;
    avgAckMinutes: number | null;
    avgRestoreMinutes: number | null;
  };
  daily: DailyResponseTrendPoint[];
  byPriority: PriorityResponseSummary[];
}

const WINDOW_OPTIONS: { value: ResponseTrendWindow; label: string }[] = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

/** "125" -> "2h 5m"; "45" -> "45m"; null -> "—" (no incidents reached that
 * milestone yet in the window — not the same as "0 minutes"). */
function formatMinutes(minutes: number | null): string {
  if (minutes === null) {
    return "—";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function SummaryTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h4">{value}</Typography>
        {sub && (
          <Typography variant="caption" color="text.secondary">
            {sub}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Incident response trend (spec §10.16) — MTTA/MTTR over a rolling window,
 * fed by GET /reports/response-trend. Deliberately its own page rather than
 * folded into the Command Center: that page is a live/point-in-time read,
 * this one necessarily looks backward over history.
 */
export function InsightsPage() {
  const [windowDays, setWindowDays] = useState<ResponseTrendWindow>(30);
  const [report, setReport] = useState<ResponseTrendReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReport(null);
    setError(null);
    apiGet<ResponseTrendReport>(`/reports/response-trend?windowDays=${windowDays}`)
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
        <Typography variant="h4">Insights</Typography>
        <ToggleButtonGroup
          value={windowDays}
          exclusive
          size="small"
          onChange={(_e, value: ResponseTrendWindow | null) => {
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
          Could not load the response trend: {error}. Is `pnpm dev:api` running?
        </Alert>
      )}

      {!report && !error && <Typography color="text.secondary">Loading...</Typography>}

      {report && (
        <>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Incident response,{" "}
            {WINDOW_OPTIONS.find((o) => o.value === windowDays)?.label.toLowerCase()}
          </Typography>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={4}>
              <SummaryTile label="Incidents created" value={`${report.overall.incidentCount}`} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <SummaryTile
                label="Avg time to acknowledge"
                value={formatMinutes(report.overall.avgAckMinutes)}
                sub="Created → acknowledged"
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <SummaryTile
                label="Avg time to restore"
                value={formatMinutes(report.overall.avgRestoreMinutes)}
                sub="Created → resolved"
              />
            </Grid>
          </Grid>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Daily average response time
              </Typography>
              {report.daily.every((d) => d.incidentsCreated === 0) ? (
                <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
                  No incidents were created in this window.
                </Typography>
              ) : (
                <LineChart
                  xAxis={[
                    {
                      scaleType: "point",
                      data: report.daily.map((d) => d.date.slice(5)), // MM-DD
                    },
                  ]}
                  series={[
                    {
                      label: "Avg time to acknowledge",
                      data: report.daily.map((d) => d.avgAckMinutes),
                      color: "#1976d2",
                      connectNulls: true,
                      valueFormatter: (value) => formatMinutes(value),
                    },
                    {
                      label: "Avg time to restore",
                      data: report.daily.map((d) => d.avgRestoreMinutes),
                      color: "#d32f2f",
                      connectNulls: true,
                      valueFormatter: (value) => formatMinutes(value),
                    },
                  ]}
                  height={280}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                By priority
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Priority</TableCell>
                      <TableCell align="right">Incidents</TableCell>
                      <TableCell align="right">Avg time to acknowledge</TableCell>
                      <TableCell align="right">Avg time to restore</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {report.byPriority.map((row) => (
                      <TableRow key={row.priority}>
                        <TableCell>{row.priority}</TableCell>
                        <TableCell align="right">{row.incidentCount}</TableCell>
                        <TableCell align="right">{formatMinutes(row.avgAckMinutes)}</TableCell>
                        <TableCell align="right">{formatMinutes(row.avgRestoreMinutes)}</TableCell>
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
