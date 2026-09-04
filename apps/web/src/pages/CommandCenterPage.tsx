import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Alert, Card, CardActionArea, CardContent, Grid, Typography } from "@mui/material";
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
      <Typography variant="h4" gutterBottom>
        Command Center
      </Typography>

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
