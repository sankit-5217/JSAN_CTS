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
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import FilterListRoundedIcon from "@mui/icons-material/FilterListRounded";
import type { IncidentStatus, Priority } from "@cts-dc-opsdesk/shared-types";
import { apiGet } from "../../api/client";
import { isFinished, relativeTime, STATUS_COLOR, STATUS_LABEL } from "./clientTicket";
import { describeActivity, SLA_LABEL, useClientPortal, type PortalTicket } from "./clientPortal";
import {
  matchesView,
  viewDefinition,
  type ClientTicketView,
} from "./clientViews";
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

/**
 * The client's ticket list. The left nav chooses which view is showing
 * (Reported by Me / Assigned to Me / Resolved by Me / All Open / All
 * Resolved); this page applies that filter, so each tab shows exactly
 * what its name says.
 */
export function MyTicketsPage() {
  const [incidents, setIncidents] = useState<ClientIncident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(true);
  const view = (params.get("view") as ClientTicketView | null) ?? "reported";
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

  // SLA badges and live activity are extras on top of the list: if the
  // overview fails to load, the tickets still show without them.
  const { ticketsById } = useClientPortal();

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const inc of incidents ?? []) {
      const key = inc.issueType ?? "";
      c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  }, [incidents]);

  // The ticket list carries the status; the customer's own "is it fixed?"
  // answer comes from the portal overview, which loads it alongside the
  // SLA state. Without it we can still filter on status, just not on the
  // customer's answer.
  const withFeedback = useMemo(
    () =>
      (incidents ?? []).map((inc) => ({
        ...inc,
        feedback: ticketsById.get(inc.id)?.feedback ?? null,
      })),
    [incidents, ticketsById],
  );

  const shown = useMemo(() => {
    return withFeedback
      .filter((inc) => matchesView(inc, view))
      .filter((inc) => !typeFilter || inc.issueType === typeFilter)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [withFeedback, view, typeFilter]);

  const definition = viewDefinition(view);
  const emptyMessage = (() => {
    if (!incidents) return "";
    if (incidents.length === 0) {
      return 'Nothing reported yet. Use "Create Ticket" when something comes up.';
    }
    if (typeFilter) return "No tickets of this type in this view.";
    switch (view) {
      case "assigned":
        return "Nothing is waiting on you right now.";
      case "resolved":
        return "You haven't confirmed a fix yet.";
      case "open":
        return "No open tickets — everything has been resolved.";
      case "resolved-all":
        return "Nothing has been resolved yet.";
      default:
        return "No tickets here.";
    }
  })();

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
            {definition.label}
          </Typography>
          <Typography color="text.secondary">{definition.hint}</Typography>
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
            Create Ticket
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

      {error && <Alert severity="error">Couldn't load your tickets: {error}</Alert>}
      {!error && incidents === null && <Typography color="text.secondary">Loading...</Typography>}
      {incidents && shown.length === 0 && (
        <Card elevation={0} sx={{ borderRadius: 3, border: "1px dashed", borderColor: "divider" }}>
          <CardContent sx={{ py: 5, textAlign: "center" }}>
            <Typography color="text.secondary">{emptyMessage}</Typography>
          </CardContent>
        </Card>
      )}

      <Stack spacing={1.25}>
        {shown.map((inc) => (
          <TicketRow
            key={inc.id}
            incident={inc}
            portal={ticketsById.get(inc.id)}
            waitingOnYou={
              inc.status === "PENDING_CUSTOMER" ||
              (inc.status === "RESOLVED" && !inc.feedback)
            }
          />
        ))}
      </Stack>
    </Box>
  );
}

export function TicketRow({
  incident: inc,
  portal,
  waitingOnYou = false,
}: {
  incident: ClientIncident & { feedback?: { outcome: string; at: string } | null };
  portal?: PortalTicket;
  /** The next move is the customer's — surfaced as a prompt on the row. */
  waitingOnYou?: boolean;
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
        borderColor: waitingOnYou ? "warning.light" : "divider",
        borderLeftWidth: waitingOnYou ? 4 : 1,
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
            {waitingOnYou && (
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
