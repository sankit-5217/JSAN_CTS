import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Alert, Box, Card, CardContent, Chip, Link, Stack, Typography } from "@mui/material";
import type { IncidentStatus, Priority } from "@cts-dc-opsdesk/shared-types";
import { apiGet } from "../../api/client";

interface Incident {
  id: string;
  incidentNo: string;
  status: IncidentStatus;
  priority: Priority;
  shortDescription: string;
  createdAt: string;
}

interface Paginated<T> {
  items: T[];
  total: number;
}

// Plain-language status labels for a non-technical audience, plus which
// ones mean "we're waiting on you" (worth calling out — everything else is
// "sit tight"). Backend statuses are the source of truth (spec §15); this
// is presentation-only.
const STATUS_LABEL: Record<IncidentStatus, string> = {
  NEW: "Received",
  ASSIGNED: "Assigned to an engineer",
  ACKNOWLEDGED: "Being worked on",
  IN_PROGRESS: "In progress",
  PENDING_VENDOR: "Waiting on a vendor",
  PENDING_CUSTOMER: "Waiting on your input",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
};

const STATUS_COLOR: Record<IncidentStatus, "info" | "warning" | "success" | "default"> = {
  NEW: "info",
  ASSIGNED: "info",
  ACKNOWLEDGED: "info",
  IN_PROGRESS: "info",
  PENDING_VENDOR: "warning",
  PENDING_CUSTOMER: "warning",
  RESOLVED: "success",
  CLOSED: "default",
  REOPENED: "warning",
  CANCELLED: "default",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  P1: "Critical",
  P2: "High",
  P3: "Standard",
  P4: "Low",
};

export function MyTicketsPage() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Paginated<Incident>>("/incidents")
      .then((res) => setIncidents(res.items))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        My tickets
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Everything you've reported, and where it stands.
      </Typography>

      {error && <Alert severity="error">{error}</Alert>}
      {!error && incidents === null && <Typography color="text.secondary">Loading...</Typography>}
      {incidents?.length === 0 && (
        <Card elevation={0} sx={{ borderRadius: 3, border: "1px dashed", borderColor: "divider" }}>
          <CardContent sx={{ py: 5, textAlign: "center" }}>
            <Typography color="text.secondary">
              Nothing reported yet — use "Report an issue" above when something comes up.
            </Typography>
          </CardContent>
        </Card>
      )}

      <Stack spacing={1.5}>
        {incidents?.map((inc) => (
          <Card
            key={inc.id}
            elevation={0}
            sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider" }}
          >
            <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
              <Box sx={{ flex: 1, minWidth: 220 }}>
                <Link
                  component={RouterLink}
                  to={`/client/tickets/${inc.id}`}
                  sx={{ fontWeight: 600, textDecoration: "none" }}
                >
                  {inc.shortDescription}
                </Link>
                <Typography variant="body2" color="text.secondary">
                  {inc.incidentNo} · reported {new Date(inc.createdAt).toLocaleDateString()}
                </Typography>
              </Box>
              <Chip
                size="small"
                label={PRIORITY_LABEL[inc.priority]}
                variant="outlined"
                sx={{ display: { xs: "none", sm: "inline-flex" } }}
              />
              <Chip
                size="small"
                color={STATUS_COLOR[inc.status]}
                label={STATUS_LABEL[inc.status]}
              />
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}
