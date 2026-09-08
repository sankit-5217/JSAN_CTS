import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  Grid,
  Stack,
  Typography,
} from "@mui/material";
import SensorsOutlinedIcon from "@mui/icons-material/SensorsOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import AssignmentTurnedInOutlinedIcon from "@mui/icons-material/AssignmentTurnedInOutlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import { BarChart } from "@mui/x-charts/BarChart";
import { PieChart } from "@mui/x-charts/PieChart";
import { apiGet } from "../api/client";

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
  const step = FLOW_STEPS[activeStep];

  return (
    <Card
      sx={{
        mb: 4,
        overflow: "hidden",
        border: "1px solid rgba(15, 61, 99, 0.12)",
        background: "linear-gradient(120deg, #102f4a 0%, #174f68 58%, #236b6b 100%)",
        color: "#f8fbfa",
      }}
    >
      <CardContent sx={{ p: { xs: 2.5, md: 4 }, "&:last-child": { pb: { xs: 2.5, md: 4 } } }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={3} justifyContent="space-between">
          <Box sx={{ maxWidth: 520 }}>
            <Typography
              variant="overline"
              sx={{ color: "#9bd6c9", letterSpacing: "0.14em", fontWeight: 700 }}
            >
              THE OPSDESK LOOP
            </Typography>
            <Typography variant="h4" sx={{ mt: 0.5, mb: 1, fontWeight: 700 }}>
              From signal to decision
            </Typography>
            <Typography sx={{ color: "rgba(248,251,250,0.76)", maxWidth: 470 }}>
              One governed path for the data-center operation: observe the estate, correlate impact,
              resolve service, and preserve what the team learned.
            </Typography>
          </Box>
          <Box sx={{ minWidth: { md: 280 }, alignSelf: { md: "flex-end" } }}>
            <Typography variant="caption" sx={{ color: "rgba(248,251,250,0.62)" }}>
              CURRENT STAGE
            </Typography>
            <Typography variant="h6" sx={{ color: "#f4c979", mt: 0.25 }}>
              {step.label} / {step.title}
            </Typography>
          </Box>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(4, 1fr)" },
            gap: { xs: 1, sm: 0 },
            mt: 4,
            mb: 3,
          }}
        >
          {FLOW_STEPS.map((flowStep, index) => {
            const Icon = flowStep.icon;
            const isActive = index === activeStep;
            return (
              <Box key={flowStep.label} sx={{ position: "relative", display: "flex", alignItems: "center" }}>
                <Box
                  component="button"
                  type="button"
                  onClick={() => setActiveStep(index)}
                  aria-label={`Show ${flowStep.label} stage`}
                  sx={{
                    position: "relative",
                    zIndex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 1.25,
                    width: "100%",
                    border: 0,
                    borderRadius: 1,
                    p: 1,
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                    backgroundColor: isActive ? "rgba(255,255,255,0.14)" : "transparent",
                    transition: "background-color 160ms ease, transform 160ms ease",
                    "&:hover": { backgroundColor: "rgba(255,255,255,0.1)", transform: "translateY(-2px)" },
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
                      color: flowStep.color,
                      backgroundColor: "#f8fbfa",
                    }}
                  >
                    <Icon fontSize="small" />
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ display: "block", color: "rgba(248,251,250,0.58)" }}>
                      0{index + 1}
                    </Typography>
                    <Typography sx={{ fontWeight: 700 }}>{flowStep.label}</Typography>
                  </Box>
                </Box>
                {index < FLOW_STEPS.length - 1 && (
                  <Box
                    sx={{
                      display: { xs: "none", sm: "block" },
                      position: "absolute",
                      left: "calc(50% + 26px)",
                      right: "-50%",
                      top: 29,
                      height: 1,
                      backgroundColor: "rgba(248,251,250,0.22)",
                    }}
                  />
                )}
              </Box>
            );
          })}
        </Box>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1.25fr 1fr" },
            gap: 3,
            p: { xs: 2, md: 2.5 },
            borderRadius: 1,
            backgroundColor: "rgba(5, 25, 39, 0.28)",
          }}
        >
          <Box>
            <Typography variant="overline" sx={{ color: step.color, fontWeight: 700, letterSpacing: "0.12em" }}>
              {step.eyebrow}
            </Typography>
            <Typography variant="h6" sx={{ mb: 0.75 }}>{step.title}</Typography>
            <Typography sx={{ color: "rgba(248,251,250,0.72)" }}>{step.description}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: "rgba(248,251,250,0.58)" }}>
              WHAT MOVES FORWARD
            </Typography>
            <Stack spacing={1} sx={{ mt: 1 }}>
              {step.outputs.map((output) => (
                <Box key={output} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Box sx={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: step.color }} />
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

  useEffect(() => {
    apiGet<CommandCenterSummary>("/reports/command-center")
      .then(setSummary)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <>
      <Typography variant="h4" gutterBottom>Command Center</Typography>
      <OperationsFlow />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load the Command Center summary: {error}. Is `pnpm dev:api` running?
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
