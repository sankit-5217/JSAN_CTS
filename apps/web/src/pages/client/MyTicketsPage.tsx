import { SlaBadge } from "./SlaBadge";
import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  IconButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import FilterListRoundedIcon from "@mui/icons-material/FilterListRounded";
import type { IncidentStatus, Priority } from "@cts-dc-opsdesk/shared-types";
import { apiGet } from "../../api/client";
import {
  isFinished,
  needsYou,
  relativeTime,
  STATUS_COLOR,
  STATUS_LABEL,
} from "./clientTicket";
import { describeActivity, SLA_LABEL, useClientPortal, type PortalTicket } from "./clientPortal";
import { useAnsweredResolutions } from "./useAnsweredResolutions";
import {
  ISSUE_TYPE_ORDER,
  ISSUE_TYPE_TONE,
  issueTypeLabel,
  IssueTypeChip,
  PriorityChip,
  SeverityChip,
} from "./ticketVisuals";

export interface ClientIncident {
  id: string;
  incidentNo: string;
  status: IncidentStatus;
  priority: Priority;
  issueType: string | null;
  severity: string | null;
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
  const [showFilters, setShowFilters] = useState(true);
  const filter = (FILTERS.find((f) => f.value === params.get("show"))?.value ?? "open") as Filter;
  const typeFilter = params.get("type") ?? "";

  const setType = (t: string) => {
    const next = new URLSearchParams(params);
    if (typeFilter === t) next.delete("type");
    else next.set("type", t);
    setParams(next, { replace: true });
  };

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

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const inc of incidents ?? []) {
      const key = inc.issueType ?? "";
      c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  }, [incidents]);

  const shown = useMemo(() => {
    const match = FILTERS.find((f) => f.value === filter)!.match;
    return (incidents ?? [])
      .filter((i) => match(i, answered) && (!typeFilter || i.issueType === typeFilter))
      .sort(
        (a, b) =>
          Number(needsYou(b, answered)) - Number(needsYou(a, answered)) ||
          b.updatedAt.localeCompare(a.updatedAt),
      );
  }, [incidents, filter, answered, typeFilter]);

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
        <Stack direction="row" spacing={1} alignItems="center">
          <Tooltip title={showFilters ? "Hide issue-type filters" : "Show issue-type filters"}>
            <IconButton
              aria-label="Toggle issue-type filters"
              aria-expanded={showFilters}
              onClick={() => setShowFilters((v) => !v)}
              sx={{
                width: 40,
                height: 40,
                borderRadius: 2,
                border: "1px solid",
                borderColor: typeFilter ? "primary.main" : "divider",
                color: typeFilter ? "primary.main" : "text.secondary",
                bgcolor: (t) =>
                  typeFilter ? alpha(t.palette.primary.main, 0.08) : "background.paper",
                "&:hover": { bgcolor: (t) => alpha(t.palette.primary.main, 0.12) },
              }}
            >
              <Badge variant="dot" color="primary" invisible={!typeFilter}>
                <FilterListRoundedIcon />
              </Badge>
            </IconButton>
          </Tooltip>
          <Button
            component={RouterLink}
            to="/client/report"
            variant="contained"
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            Report an issue
          </Button>
        </Stack>
      </Stack>

      {incidents && showFilters && (
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 2 }}
          aria-label="Filter by issue type"
        >
          {ISSUE_TYPE_ORDER.map((t) => {
            const tone = ISSUE_TYPE_TONE[t];
            const active = typeFilter === t;
            return (
              <Chip
                key={t}
                clickable
                onClick={() => setType(t)}
                label={`${issueTypeLabel(t)} ${typeCounts[t] ?? 0}`}
                sx={{
                  color: tone.text,
                  backgroundColor: active ? tone.border : tone.bg,
                  border: "1px solid",
                  borderColor: active ? tone.text : tone.border,
                  borderRadius: 2,
                  fontWeight: 700,
                  "& .MuiChip-label": { px: 1.25 },
                }}
              />
            );
          })}
          {typeFilter && (
            <Chip
              clickable
              variant="outlined"
              onClick={() => setType(typeFilter)}
              label="Clear filter"
              sx={{ borderRadius: 2, textTransform: "none" }}
            />
          )}
        </Stack>
      )}

      <ToggleButtonGroup
        exclusive
        size="small"
        value={filter}
        onChange={(_, v: Filter | null) => {
          if (!v) return;
          const next = new URLSearchParams(params);
          next.set("show", v);
          setParams(next, { replace: true });
        }}
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
          {sla && <SlaBadge state={sla.overall} label={`SLA: ${SLA_LABEL[sla.overall]}`} />}
          <IssueTypeChip value={inc.issueType} />
          <PriorityChip priority={inc.priority} />
          <SeverityChip value={inc.severity} />
          <Chip size="small" color={STATUS_COLOR[inc.status]} label={STATUS_LABEL[inc.status]} />
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
