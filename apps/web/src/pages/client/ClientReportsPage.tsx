import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid2 as Grid,
  Stack,
  Typography,
} from "@mui/material";
import TaskAltRoundedIcon from "@mui/icons-material/TaskAltRounded";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import { apiGet } from "../../api/client";

interface ClientPerformanceReport {
  windowDays: number;
  from: string;
  to: string;
  totals: {
    reported: number;
    open: number;
    resolved: number;
    closed: number;
  };
  sla: {
    met: number;
    breached: number;
    onTrack: number;
    atRisk: number;
    paused: number;
  };
  averages: {
    ackMinutes: number | null;
    resolveMinutes: number | null;
  };
  monthly: { month: string; reported: number; resolved: number }[];
}

/** "1h 25m" / "45m" / "20s" — a duration a customer can read at a glance. */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "2026-01" → "Jan 2026". */
export function formatMonth(month: string): string {
  const [year, m] = month.split("-");
  const date = new Date(Date.UTC(Number(year), Number(m) - 1, 1));
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * The client portal's Reports tab: how the tickets *this customer*
 * reported have been handled — counts, whether we hit our targets, and
 * how long it took. Read-only, and scoped by the API to their own
 * reports, the same set the rest of the portal shows.
 */
export function ClientReportsPage() {
  const [report, setReport] = useState<ClientPerformanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ClientPerformanceReport>("/reports/client-performance")
      .then(setReport)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return <Alert severity="error">Couldn't load your performance report: {error}</Alert>;
  }
  if (!report) {
    return <Typography color="text.secondary">Loading...</Typography>;
  }

  const { totals, sla, averages } = report;
  const peak = Math.max(1, ...report.monthly.map((m) => m.reported));

  return (
    <Box sx={{ display: "flex", flex: 1, flexDirection: "column", width: "100%", minWidth: 0 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        Reports
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        How the tickets you've reported have been handled.
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            label="Tickets reported"
            value={totals.reported}
            caption={`${totals.open} still open`}
            icon={<ReportProblemOutlinedIcon />}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            label="Resolved"
            value={totals.resolved}
            caption={`${totals.closed} closed`}
            icon={<TaskAltRoundedIcon />}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            label="Average first response"
            value={formatDuration(averages.ackMinutes)}
            caption="Time to acknowledge"
            icon={<TimerOutlinedIcon />}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatCard
            label="Average time to fix"
            value={formatDuration(averages.resolveMinutes)}
            caption="Time to resolve"
            icon={<TrendingUpRoundedIcon />}
          />
        </Grid>
      </Grid>

      <Card
        elevation={0}
        sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider", mb: 3 }}
      >
        <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Typography sx={{ fontWeight: 700, mb: 0.5 }}>Service targets</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Whether we fixed your tickets within the agreed target.
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              label={`Target met: ${sla.met}`}
              sx={{ bgcolor: "#e9f6ee", color: "#1b6e3c", fontWeight: 700 }}
            />
            <Chip
              label={`Target missed: ${sla.breached}`}
              sx={{ bgcolor: "#fdecea", color: "#b3261e", fontWeight: 700 }}
            />
            <Chip label={`Still on track: ${sla.onTrack}`} sx={{ fontWeight: 700 }} />
            <Chip
              label={`Approaching target: ${sla.atRisk}`}
              sx={{ bgcolor: "#fdf3e0", color: "#8a5a00", fontWeight: 700 }}
            />
            <Chip label={`Paused: ${sla.paused}`} sx={{ fontWeight: 700 }} />
          </Stack>
        </CardContent>
      </Card>

      <Card elevation={0} sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
        <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Typography sx={{ fontWeight: 700, mb: 0.5 }}>Tickets raised each month</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            The last {report.monthly.length} months.
          </Typography>
          <Stack spacing={1.25}>
            {report.monthly.map((month) => (
              <Box key={month.month}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ mb: 0.5 }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {formatMonth(month.month)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {month.reported} raised · {month.resolved} resolved
                  </Typography>
                </Stack>
                <Box
                  sx={{
                    height: 8,
                    borderRadius: 1,
                    bgcolor: "action.hover",
                    overflow: "hidden",
                  }}
                >
                  <Box
                    sx={{
                      height: "100%",
                      width: `${Math.round((month.reported / peak) * 100)}%`,
                      bgcolor: "primary.main",
                      borderRadius: 1,
                    }}
                  />
                </Box>
              </Box>
            ))}
          </Stack>
          <Divider sx={{ my: 2.5 }} />
          <Typography variant="body2" color="text.secondary">
            Covering {new Date(report.from).toLocaleDateString()} to{" "}
            {new Date(report.to).toLocaleDateString()}.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}

function StatCard({
  label,
  value,
  caption,
  icon,
}: {
  label: string;
  value: number | string;
  caption: string;
  icon: React.ReactElement;
}) {
  return (
    <Card
      elevation={0}
      sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider", height: "100%" }}
    >
      <CardContent>
        <Box sx={{ color: "primary.main", mb: 1, display: "flex" }}>{icon}</Box>
        <Typography sx={{ fontSize: 24, fontWeight: 800 }}>{value}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
      </CardContent>
    </Card>
  );
}
