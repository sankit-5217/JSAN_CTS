import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { IncidentStatus, Priority } from "@cts-dc-opsdesk/shared-types";
import { apiGet } from "../../api/client";
import {
  isFinished,
  needsYou,
  PRIORITY_LABEL,
  relativeTime,
  STATUS_COLOR,
  STATUS_LABEL,
} from "./clientTicket";
import {
  describeActivity,
  SLA_COLOR,
  SLA_LABEL,
  useClientPortal,
  type PortalTicket,
} from "./clientPortal";
import { useAnsweredResolutions } from "./useAnsweredResolutions";

export interface ClientIncident {
  id: string;
  incidentNo: string;
  status: IncidentStatus;
  priority: Priority;
  shortDescription: string;
  createdAt: string;
  updatedAt: string;
}

interface Paginated<T> {
  items: T[];
  total: number;
}

type Filter = "needs-you" | "open" | "closed" | "all";

const FILTERS: {
  value: Filter;
  label: string;
  match: (i: ClientIncident, answered: Set<string>) => boolean;
}[] = [
  { value: "needs-you", label: "Needs you", match: needsYou },
  { value: "open", label: "Open", match: (i) => !isFinished(i.status) },
  { value: "closed", label: "Closed", match: (i) => isFinished(i.status) },
  { value: "all", label: "All", match: () => true },
];

/** Everything this customer has reported, with the ones waiting on them
 *  called out first. The filter lives in the URL so Home can link to it. */
export function MyTicketsPage() {
  const [incidents, setIncidents] = useState<ClientIncident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS.find((f) => f.value === params.get("show"))?.value ?? "open") as Filter;

  useEffect(() => {
    apiGet<Paginated<ClientIncident>>("/incidents?limit=200")
      .then((res) => setIncidents(res.items))
      .catch((err: Error) => setError(err.message));
  }, []);

  const answered = useAnsweredResolutions(incidents);
  // SLA badges and live activity are extras on top of the list: if the
  // overview fails to load, the tickets still show without them.
  const { ticketsById } = useClientPortal();

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { "needs-you": 0, open: 0, closed: 0, all: 0 };
    for (const inc of incidents ?? []) {
      for (const f of FILTERS) if (f.match(inc, answered)) c[f.value] += 1;
    }
    return c;
  }, [incidents, answered]);

  const shown = useMemo(() => {
    const match = FILTERS.find((f) => f.value === filter)!.match;
    return (incidents ?? [])
      .filter((i) => match(i, answered))
      .sort(
        (a, b) =>
          Number(needsYou(b, answered)) - Number(needsYou(a, answered)) ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
  }, [incidents, filter, answered]);

  return (
    <Box sx={{ display: "flex", flex: 1, flexDirection: "column", width: "100%", minWidth: 0 }}>
      <Stack
        direction="row"
        alignItems="flex-end"
        justifyContent="space-between"
        flexWrap="wrap"
        useFlexGap
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
            My tickets
          </Typography>
          <Typography color="text.secondary">
            Everything you've reported, and where it stands.
          </Typography>
        </Box>
        <Button
          component={RouterLink}
          to="/client/report"
          variant="contained"
          sx={{ textTransform: "none", fontWeight: 600 }}
        >
          Report an issue
        </Button>
      </Stack>

      <ToggleButtonGroup
        exclusive
        size="small"
        value={filter}
        onChange={(_, v: Filter | null) => v && setParams({ show: v }, { replace: true })}
        sx={{ mb: 2, flexWrap: "wrap" }}
      >
        {FILTERS.map((f) => (
          <ToggleButton key={f.value} value={f.value} sx={{ textTransform: "none", px: 2 }}>
            {f.label}
            {incidents && (
              <Box
                component="span"
                sx={{
                  ml: 1,
                  fontWeight: 700,
                  color:
                    f.value === "needs-you" && counts[f.value] > 0 ? "warning.main" : "inherit",
                }}
              >
                {counts[f.value]}
              </Box>
            )}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {error && <Alert severity="error">Couldn't load your tickets: {error}</Alert>}
      {!error && incidents === null && <Typography color="text.secondary">Loading...</Typography>}
      {incidents && shown.length === 0 && (
        <Card elevation={0} sx={{ borderRadius: 3, border: "1px dashed", borderColor: "divider" }}>
          <CardContent sx={{ py: 5, textAlign: "center" }}>
            <Typography color="text.secondary">
              {incidents.length === 0
                ? 'Nothing reported yet. Use "Report an issue" when something comes up.'
                : filter === "needs-you"
                  ? "Nothing needs you right now."
                  : "No tickets here."}
            </Typography>
          </CardContent>
        </Card>
      )}

      <Stack spacing={1.25}>
        {shown.map((inc) => (
          <TicketRow
            key={inc.id}
            incident={inc}
            actionNeeded={needsYou(inc, answered)}
            portal={ticketsById.get(inc.id)}
          />
        ))}
      </Stack>
    </Box>
  );
}

export function TicketRow({
  incident: inc,
  actionNeeded,
  portal,
}: {
  incident: ClientIncident;
  actionNeeded: boolean;
  /** SLA status and live activity, once the portal overview has loaded. */
  portal?: PortalTicket;
}) {
  const activity =
    portal && !isFinished(inc.status) ? describeActivity(portal.activity, relativeTime) : null;
  const sla = inc.status === "CANCELLED" ? null : portal?.sla;
  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 3,
        border: "1px solid",
        borderColor: actionNeeded ? "warning.light" : "divider",
        borderLeftWidth: actionNeeded ? 4 : 1,
      }}
    >
      <CardActionArea component={RouterLink} to={`/client/tickets/${inc.id}`}>
        <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
              {inc.shortDescription}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {inc.incidentNo} · updated {relativeTime(inc.updatedAt)}
            </Typography>
            {actionNeeded && (
              <Typography variant="body2" sx={{ color: "warning.dark", fontWeight: 600, mt: 0.25 }}>
                {inc.status === "RESOLVED" ? "Please confirm it's fixed" : "Waiting for your reply"}
              </Typography>
            )}
            {activity && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                {activity}
              </Typography>
            )}
          </Box>
          {sla && (
            <Chip
              size="small"
              variant="outlined"
              color={SLA_COLOR[sla.overall]}
              label={`SLA: ${SLA_LABEL[sla.overall]}`}
            />
          )}
          <Chip
            size="small"
            label={PRIORITY_LABEL[inc.priority]}
            variant="outlined"
            sx={{ display: { xs: "none", sm: "inline-flex" } }}
          />
          <Chip size="small" color={STATUS_COLOR[inc.status]} label={STATUS_LABEL[inc.status]} />
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
