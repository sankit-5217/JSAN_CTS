import { useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Alert,
  Chip,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
// Type-only: shared-types builds as CommonJS (fine for its Node consumers —
// api/worker), which Rollup can't statically re-export as ESM values for a
// Vite bundle. `import type` erases before bundling, so runtime values
// below are the literal strings instead (same pattern as HealthLevel in
// CommandCenterPage.tsx) — no build-tooling change needed for a v1 shell.
import type { IncidentStatus, Priority } from "@cts-dc-opsdesk/shared-types";
import { apiGet } from "../api/client";

interface Incident {
  id: string;
  incidentNo: string;
  siteId: string;
  status: IncidentStatus;
  priority: Priority;
  shortDescription: string;
  ownerUserId: string | null;
  createdAt: string;
}

interface Paginated<T> {
  items: T[];
  total: number;
}

interface Site {
  id: string;
  code: string;
}

const PRIORITY_COLOR: Record<Priority, "error" | "warning" | "info" | "default"> = {
  P1: "error",
  P2: "warning",
  P3: "info",
  P4: "default",
};

function ageLabel(createdAt: string): string {
  const minutes = Math.round((Date.now() - new Date(createdAt).getTime()) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (24 * 60))}d`;
}

/**
 * Incident queue (Sprint 7 plan, Decision 5) — a filtered list, not a full
 * incident workspace (no timeline/comments/worklog view yet, that's a later
 * frontend feature). Reads siteId/status/slaAtRisk from the querystring so
 * Command Center's counters can deep-link here, satisfying spec §10.1's
 * "all dashboard numbers must be clickable to filtered detail views."
 */
export function IncidentsPage() {
  const [searchParams] = useSearchParams();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [sitesById, setSitesById] = useState<Record<string, string>>({});
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const siteId = searchParams.get("siteId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const slaAtRisk = searchParams.get("slaAtRisk") ?? undefined;

  useEffect(() => {
    apiGet<Site[]>("/sites")
      .then((sites) => setSitesById(Object.fromEntries(sites.map((s) => [s.id, s.code]))))
      .catch(() => undefined); // non-fatal — falls back to showing raw siteId
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (siteId) params.set("siteId", siteId);
    if (status) params.set("status", status);
    if (slaAtRisk) params.set("slaAtRisk", slaAtRisk);

    apiGet<Paginated<Incident>>(`/incidents?${params.toString()}`)
      .then((res) => {
        setIncidents(res.items);
        setTotal(res.total);
      })
      .catch((err: Error) => setError(err.message));
  }, [siteId, status, slaAtRisk]);

  const activeFilters = [
    siteId && `site: ${sitesById[siteId] ?? siteId}`,
    status && `status: ${status}`,
    slaAtRisk && "SLA at risk",
  ].filter(Boolean);

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Incidents
      </Typography>
      {activeFilters.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Filtered by {activeFilters.join(", ")} — {total} result{total === 1 ? "" : "s"}
        </Typography>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load incidents: {error}
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Incident</TableCell>
              <TableCell>Site</TableCell>
              <TableCell>Priority</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Age</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {incidents.map((incident) => (
              <TableRow key={incident.id}>
                <TableCell>
                  <Link component={RouterLink} to={`/incidents/${incident.id}`}>
                    {incident.incidentNo}
                  </Link>
                </TableCell>
                <TableCell>{sitesById[incident.siteId] ?? incident.siteId}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={incident.priority}
                    color={PRIORITY_COLOR[incident.priority]}
                  />
                </TableCell>
                <TableCell>{incident.status}</TableCell>
                <TableCell>{incident.shortDescription}</TableCell>
                <TableCell>{ageLabel(incident.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
