import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Grid,
  Stack,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import SensorsOutlinedIcon from "@mui/icons-material/SensorsOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import AssignmentTurnedInOutlinedIcon from "@mui/icons-material/AssignmentTurnedInOutlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import { BarChart } from "@mui/x-charts/BarChart";
import { PieChart } from "@mui/x-charts/PieChart";
import { apiDownload, apiGet } from "../api/client";

type HealthLevel = "HEALTHY" | "WARNING" | "CRITICAL" | "UNKNOWN";

interface SiteCard {
  id: string;
  code: string;
  name: string;
  health: HealthLevel;
  serversReachable: number;
  serversTotal: number;
  openIncidents: number;
  oldestOpenIncidentAgeMinutes: number | null;
  p1p2OpenIncidents: number;
  slaAtRiskIncidents: number;
}

interface CommandCenterSummary {
  counters: {
    sitesHealthy: number;
    sitesWarning: number;
    sitesCritical: number;
    serversReachable: number;
    serversTotal: number;
    criticalAlertsOpen: number;
    p1p2OpenIncidents: number;
    slaAtRiskIncidents: number;
  };
  siteCards: SiteCard[];
  queues: {
    unassigned: number;
    awaitingAck: number;
    slaBreachRisk: number;
    vendorWaiting: number;
    reopened: number;
  };
}

const HEALTH_COLOR: Record<HealthLevel, string> = {
  HEALTHY: "#2e7d32",
  WARNING: "#ed6c02",
  CRITICAL: "#d32f2f",
  UNKNOWN: "#757575",
};

const FLOW_STEPS = [
  {
    label: "Observe",
    eyebrow: "01 / SITE EDGE",
    title: "See the estate without exposing it",
    description:
      "Site collectors read Redfish, SNMP and monitoring platforms, then send normalized health signals outbound over TLS.",
    outputs: ["CMDB health state", "Normalized alerts", "Evidence links"],
    color: "#2f8f83",
    icon: SensorsOutlinedIcon,
  },
  {
    label: "Correlate",
    eyebrow: "02 / SIGNAL CONTROL",
    title: "Turn noisy signals into one operational truth",
    description:
      "Fingerprinting and correlation deduplicate repeated events and connect an alert to the affected site, CI and component.",
    outputs: ["Alert fingerprint", "Impact context", "Incident candidate"],
    color: "#d28b35",
    icon: HubOutlinedIcon,
  },
  {
    label: "Respond",
    eyebrow: "03 / SERVICE DESK",
    title: "Route work through governed state changes",
    description:
      "The incident service validates transitions, ownership, required fields and SLA effects before anything changes state.",
    outputs: ["Assigned owner", "SLA timer", "Audit event"],
    color: "#c9574c",
    icon: AssignmentTurnedInOutlinedIcon,
  },
  {
    label: "Learn",
    eyebrow: "04 / CONTROL ROOM",
    title: "Close the loop with durable evidence",
    description:
      "Worklogs, vendor updates, changes and append-only audit records become the source for reports, risk and problem management.",
    outputs: ["Operational report", "Problem signal", "Knowledge candidate"],
    color: "#536da7",
    icon: InsightsOutlinedIcon,
  },
] as const;

function OperationsFlow() {
  const [activeStep, setActiveStep] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const step = FLOW_STEPS[activeStep];
  const stepCount = FLOW_STEPS.length;

  const prefersReducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  // Auto-advance the loop so it reads as alive without requiring a click;
  // pausing on hover (and skipping entirely under prefers-reduced-motion)
  // keeps it from fighting a user who's actually reading a stage.
  useEffect(() => {
    if (prefersReducedMotion || isPaused) return undefined;
    const id = window.setInterval(() => {
      setActiveStep((prev) => (prev + 1) % stepCount);
    }, 5000);
    return () => window.clearInterval(id);
  }, [isPaused, prefersReducedMotion, stepCount]);

  return (
    <Card
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      sx={{ mb: 4, overflow: "hidden", border: "1px solid rgba(15, 61, 99, 0.12)" }}
    >
      <CardContent sx={{ p: { xs: 2.5, md: 4 }, "&:last-child": { pb: { xs: 2.5, md: 4 } } }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={3} justifyContent="space-between">
          <Box sx={{ maxWidth: 520 }}>
            <Typography
              variant="overline"
              sx={{ color: "secondary.main", letterSpacing: "0.14em", fontWeight: 700 }}
            >
              THE OPSDESK LOOP
            </Typography>
            <Typography
              variant="h4"
              sx={{ mt: 0.5, mb: 1, fontWeight: 700, color: "primary.main" }}
            >
              From signal to decision
            </Typography>
            <Typography color="text.secondary" sx={{ maxWidth: 470 }}>
              One governed path for the data-center operation: observe the estate, correlate impact,
              resolve service, and preserve what the team learned.
            </Typography>
          </Box>
          <Box
            sx={{
              minWidth: { md: 240 },
              alignSelf: { md: "flex-end" },
              textAlign: { xs: "left", md: "right" },
            }}
          >
            <Typography variant="caption" color="text.secondary">
              CURRENT STAGE
            </Typography>
            <Typography variant="h6" sx={{ color: step.color, mt: 0.25, fontWeight: 700 }}>
              {step.label} / {step.title}
            </Typography>
          </Box>
        </Stack>

        {/* A real progress gauge, not four flat buttons: a track fills from
            the first step to the active one, with per-step circles layered
            above it, since Observe -> Correlate -> Respond -> Learn is an
            actual sequence rather than four unrelated options. */}
        <Box sx={{ position: "relative", mt: 5, mb: 1 }}>
          <Box
            sx={{
              position: "absolute",
              top: 19,
              left: 19,
              right: 19,
              height: 3,
              borderRadius: 2,
              backgroundColor: "rgba(15, 61, 99, 0.12)",
            }}
          />
          <Box
            sx={{
              position: "absolute",
              top: 19,
              left: 19,
              height: 3,
              borderRadius: 2,
              backgroundColor: "secondary.main",
              width: `calc((100% - 38px) * ${activeStep / (stepCount - 1)})`,
              transition: prefersReducedMotion ? "none" : "width 500ms ease",
            }}
          />
          <Stack direction="row" sx={{ position: "relative" }}>
            {FLOW_STEPS.map((flowStep, index) => {
              const Icon = flowStep.icon;
              const isActive = index === activeStep;
              const isDone = index < activeStep;
              const reached = isActive || isDone;
              return (
                <Box
                  key={flowStep.label}
                  component="button"
                  type="button"
                  onClick={() => setActiveStep(index)}
                  aria-label={`Show ${flowStep.label} stage`}
                  aria-current={isActive ? "step" : undefined}
                  sx={{
                    flex: "1 1 0",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.75,
                    minWidth: 0,
                    border: 0,
                    background: "none",
                    p: 0.5,
                    font: "inherit",
                    cursor: "pointer",
                    color: "inherit",
                  }}
                >
                  <Box
                    sx={{
                      display: "grid",
                      placeItems: "center",
                      width: 38,
                      height: 38,
                      borderRadius: "50%",
                      flexShrink: 0,
                      backgroundColor: reached ? flowStep.color : "#fff",
                      color: reached ? "#fff" : "text.disabled",
                      border: reached ? "none" : "2px solid rgba(15, 61, 99, 0.18)",
                      boxShadow: isActive ? `0 0 0 5px ${alpha(flowStep.color, 0.18)}` : "none",
                      transition: "background-color 200ms ease, box-shadow 200ms ease",
                    }}
                  >
                    <Icon fontSize="small" />
                  </Box>
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? flowStep.color : "text.secondary",
                    }}
                  >
                    {flowStep.label}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        </Box>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1.25fr 1fr" },
            gap: 3,
            mt: 3,
            p: { xs: 2, md: 2.5 },
            borderRadius: 1,
            backgroundColor: alpha(step.color, 0.06),
            border: `1px solid ${alpha(step.color, 0.18)}`,
            transition: "background-color 200ms ease, border-color 200ms ease",
          }}
        >
          <Box>
            <Typography
              variant="overline"
              sx={{ color: step.color, fontWeight: 700, letterSpacing: "0.12em" }}
            >
              {step.eyebrow}
            </Typography>
            <Typography variant="h6" sx={{ mb: 0.75 }}>
              {step.title}
            </Typography>
            <Typography color="text.secondary">{step.description}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              WHAT MOVES FORWARD
            </Typography>
            <Stack spacing={1} sx={{ mt: 1 }}>
              {step.outputs.map((output) => (
                <Box key={output} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Box
                    sx={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: step.color }}
                  />
                  <Typography variant="body2">{output}</Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

/** A plain info tile (not clickable — see the module doc comment below for
 * which counters don't have a clean filtered drill-down yet). */
function CounterTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
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

/** A clickable tile — spec §10.1: "all dashboard numbers must be clickable
 * to filtered detail views." Links into the Incidents queue page. */
function LinkedCounterTile({
  label,
  value,
  to,
}: {
  label: string;
  value: string | number;
  to: string;
}) {
  return (
    <Card sx={{ height: "100%" }}>
      <CardActionArea component={RouterLink} to={to} sx={{ height: "100%" }}>
        <CardContent>
          <Typography variant="subtitle2" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h4">{value}</Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

/**
 * Landing page per spec §10.1: "What is unhealthy, where, who owns it, and
 * what needs attention now?" — global counters, site health cards, and
 * operational queues, fed by GET /reports/command-center.
 *
 * Not every number is clickable yet (Sprint 7 plan, Decision 5's scope):
 * the operational queues and site cards drill into the Incidents page
 * cleanly (siteId/status/slaAtRisk are all supported filters); the
 * sites-healthy/critical counters and P1+P2 combined counter don't have a
 * matching filtered view yet (no priority-list or site-health filter on
 * /incidents or /sites), so those stay plain info tiles for now rather
 * than linking somewhere misleading.
 */
export function CommandCenterPage() {
  const [summary, setSummary] = useState<CommandCenterSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<CommandCenterSummary>("/reports/command-center")
      .then(setSummary)
      .catch((err: Error) => setError(err.message));
  }, []);

  async function handleDownloadReport() {
    setDownloading(true);
    setDownloadError(null);
    try {
      const date = new Date().toISOString().slice(0, 10);
      await apiDownload(
        "/reports/operational-health.csv",
        `operational-health-report-${date}.csv`,
      );
    } catch (err) {
      setDownloadError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ sm: "center" }}
        spacing={1}
        sx={{ mb: 1 }}
      >
        <Typography variant="h4" gutterBottom sx={{ mb: { xs: 0, sm: 1 } }}>
          Command Center
        </Typography>
        <Button
          variant="outlined"
          startIcon={<DownloadOutlinedIcon />}
          onClick={handleDownloadReport}
          disabled={downloading}
        >
          {downloading ? "Preparing report..." : "Download report (CSV)"}
        </Button>
      </Stack>
      <OperationsFlow />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load the Command Center summary: {error}. Is `pnpm dev:api` running?
        </Alert>
      )}
      {downloadError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDownloadError(null)}>
          Could not generate the report: {downloadError}
        </Alert>
      )}

      {!summary && !error && <Typography color="text.secondary">Loading...</Typography>}

      {summary && (
        <>
          <Typography variant="h6" sx={{ mt: 1, mb: 1 }}>
            Global counters
          </Typography>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={6} sm={4} md={2}>
              <CounterTile
                label="Sites healthy"
                value={`${summary.counters.sitesHealthy}`}
                sub={`${summary.counters.sitesWarning} warning, ${summary.counters.sitesCritical} critical`}
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <CounterTile
                label="Servers reachable"
                value={`${summary.counters.serversReachable}/${summary.counters.serversTotal}`}
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <CounterTile
                label="Critical alerts"
                value={`${summary.counters.criticalAlertsOpen}`}
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <CounterTile
                label="P1/P2 open incidents"
                value={`${summary.counters.p1p2OpenIncidents}`}
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2}>
              <LinkedCounterTile
                label="SLA at risk"
                value={summary.counters.slaAtRiskIncidents}
                to="/incidents?slaAtRisk=true"
              />
            </Grid>
          </Grid>

          {/* Visual complement to the counters above -- not a replacement for
              the clickable tiles (spec §10.1's drill-down requirement stays
              satisfied by those), just a proportion-at-a-glance view. */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Sites by health
              </Typography>
              <PieChart
                series={[
                  {
                    data: [
                      {
                        id: "healthy",
                        label: "Healthy",
                        value: summary.counters.sitesHealthy,
                        color: HEALTH_COLOR.HEALTHY,
                      },
                      {
                        id: "warning",
                        label: "Warning",
                        value: summary.counters.sitesWarning,
                        color: HEALTH_COLOR.WARNING,
                      },
                      {
                        id: "critical",
                        label: "Critical",
                        value: summary.counters.sitesCritical,
                        color: HEALTH_COLOR.CRITICAL,
                      },
                      {
                        id: "unknown",
                        label: "Unknown",
                        value: Math.max(
                          0,
                          summary.siteCards.length -
                            summary.counters.sitesHealthy -
                            summary.counters.sitesWarning -
                            summary.counters.sitesCritical,
                        ),
                        color: HEALTH_COLOR.UNKNOWN,
                      },
                    ].filter((slice) => slice.value > 0),
                    innerRadius: 40,
                    paddingAngle: 2,
                  },
                ]}
                height={220}
              />
            </CardContent>
          </Card>

          <Typography variant="h6" sx={{ mb: 1 }}>
            Operational queues
          </Typography>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={6} sm={4} md={2.4}>
              <LinkedCounterTile
                label="Unassigned"
                value={summary.queues.unassigned}
                to="/incidents?status=NEW"
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2.4}>
              <LinkedCounterTile
                label="Awaiting ack"
                value={summary.queues.awaitingAck}
                to="/incidents?status=ASSIGNED"
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2.4}>
              <LinkedCounterTile
                label="SLA breach risk"
                value={summary.queues.slaBreachRisk}
                to="/incidents?slaAtRisk=true"
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2.4}>
              <LinkedCounterTile
                label="Vendor waiting"
                value={summary.queues.vendorWaiting}
                to="/incidents?status=PENDING_VENDOR"
              />
            </Grid>
            <Grid item xs={6} sm={4} md={2.4}>
              <LinkedCounterTile
                label="Reopened"
                value={summary.queues.reopened}
                to="/incidents?status=REOPENED"
              />
            </Grid>
          </Grid>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Queue sizes
              </Typography>
              <BarChart
                xAxis={[
                  {
                    scaleType: "band",
                    data: [
                      "Unassigned",
                      "Awaiting ack",
                      "SLA breach risk",
                      "Vendor waiting",
                      "Reopened",
                    ],
                  },
                ]}
                series={[
                  {
                    data: [
                      summary.queues.unassigned,
                      summary.queues.awaitingAck,
                      summary.queues.slaBreachRisk,
                      summary.queues.vendorWaiting,
                      summary.queues.reopened,
                    ],
                    color: "#1976d2",
                  },
                ]}
                height={220}
              />
            </CardContent>
          </Card>

          <Typography variant="h6" sx={{ mb: 1 }}>
            Sites
          </Typography>
          <Grid container spacing={2}>
            {summary.siteCards.map((site) => (
              <Grid item xs={12} sm={6} md={4} key={site.id}>
                <Card>
                  <CardActionArea component={RouterLink} to={`/incidents?siteId=${site.id}`}>
                    <CardContent>
                      <Typography
                        variant="subtitle2"
                        sx={{ color: HEALTH_COLOR[site.health], fontWeight: 600 }}
                      >
                        {site.health}
                      </Typography>
                      <Typography variant="h6">
                        {site.code} — {site.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Servers: {site.serversReachable}/{site.serversTotal} reachable
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Open incidents: {site.openIncidents}
                        {site.oldestOpenIncidentAgeMinutes !== null &&
                          ` (oldest ${Math.round(site.oldestOpenIncidentAgeMinutes / 60)}h)`}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
            {summary.siteCards.length === 0 && (
              <Grid item xs={12}>
                <Typography color="text.secondary">No sites in scope.</Typography>
              </Grid>
            )}
          </Grid>
        </>
      )}
    </>
  );
}
