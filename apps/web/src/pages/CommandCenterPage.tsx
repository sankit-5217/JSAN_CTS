import { useEffect, useState } from "react";
import { Alert, Card, CardContent, Grid, Typography } from "@mui/material";
import { apiGet } from "../api/client";

interface HealthResponse {
  status: string;
  service: string;
  timestamp: string;
}

/**
 * Landing page per spec §10.1 / §19: an operations dashboard, not a ticket
 * inbox. Answers "What is unhealthy, where, who owns it, and what needs
 * attention now?" Global counters, site cards and operational queues land
 * here as the sites/incidents/sla modules are built out (Sprint 7).
 */
export function CommandCenterPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<HealthResponse>("/health")
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Command Center
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Site health, SLA-at-risk queues and operational counters will render here (spec §10.1). This
        is the Sprint 1 foundation placeholder.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not reach the API: {error}. Is `pnpm dev:api` running?
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">
                API status
              </Typography>
              <Typography variant="h6">
                {health ? health.status.toUpperCase() : "checking..."}
              </Typography>
              {health && (
                <Typography variant="caption" color="text.secondary">
                  {health.service} @ {health.timestamp}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
