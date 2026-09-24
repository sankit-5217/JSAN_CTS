import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  LinearProgress,
  Link,
  List,
  ListItem,
  ListItemAvatar,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, keyframes } from "@mui/material/styles";
import AssignmentIndOutlinedIcon from "@mui/icons-material/AssignmentIndOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import HourglassTopOutlinedIcon from "@mui/icons-material/HourglassTopOutlined";
import PersonOffOutlinedIcon from "@mui/icons-material/PersonOffOutlined";
import PersonSearchOutlinedIcon from "@mui/icons-material/PersonSearchOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload, getStoredToken } from "../api/client";
import { decodeJwtPayload, getCurrentUserRole } from "../api/jwt";
import { severityColors } from "../theme/theme";

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;

const WORKLOG_ACTIVITY_TYPES = ["REMOTE_WORK", "ONSITE", "TRAVEL", "VENDOR_CALL"];
const IMPACT_URGENCY_VALUES = ["HIGH", "MEDIUM", "LOW"];
const PRIORITY_VALUES = ["P1", "P2", "P3", "P4"];

// Mirrors IncidentsService's INCIDENT_ROUTING_ROLES — UI-only gate so a Site
// Engineer sees disabled controls instead of a 403 after filling the form.
// The backend re-checks this regardless (CLAUDE.md: never trust the frontend
// for authorization).
const INCIDENT_ROUTING_ROLES = [
  "SUPER_ADMIN",
  "DELIVERY_OPS_MANAGER",
  "INFRASTRUCTURE_LEAD",
  "SERVICE_DESK_NOC",
];

// A field name as it appears in TransitionRule.requiredFields on the
// backend (apps/api/src/modules/incidents/incident-transitions.ts).
type TransitionField = "reason" | "resolutionCategory" | "rootCauseSummary";

interface AvailableTransition {
  toStatus: string;
  requiredFields: TransitionField[];
  allowed: boolean;
  blockedReason?: string;
  /** E.g. NEW -> ASSIGNED needs an owner resolved — not a requiredFields
   * entry (that's reason/resolutionCategory/rootCauseSummary only), so the
   * backend surfaces it here instead. */
  hint?: string;
}

interface Incident {
  id: string;
  incidentNo: string;
  siteId: string;
  ciId: string | null;
  status: string;
  priority: string;
  category: string;
  impact: string;
  urgency: string;
  shortDescription: string;
  ownerUserId: string | null;
  ownerGroupId: string | null;
  acknowledgedAt: string | null;
  resolutionCategory: string | null;
  rootCauseSummary: string | null;
  restoredAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

interface SlaState {
  ackDueAt: string | null;
  ackedAt: string | null;
  resolveDueAt: string | null;
  resolvedAt: string | null;
  pausedAt: string | null;
  breached: boolean;
}

interface IncidentEvent {
  id: string;
  eventType: string;
  actorId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Plain-language line for a ROUTING timeline entry; null for other types
 *  (they keep the raw payload view). */
function describeRoutingEvent(e: IncidentEvent): string | null {
  if (e.eventType !== "ROUTING") return null;
  const p = e.payload;
  const name = typeof p.displayName === "string" ? p.displayName : "an engineer";
  switch (p.action) {
    case "OFFERED":
      return `Offered to ${name}, who has until ${new Date(String(p.expiresAt)).toLocaleTimeString()} to accept`;
    case "DECLINED":
      return p.reason ? `${name} declined: "${String(p.reason)}"` : `${name} declined`;
    case "EXPIRED":
      return `${name} didn't answer in time`;
    case "UNACCEPTED":
      return `No engineer accepted. Offered to ${
        Array.isArray(p.offeredTo) ? p.offeredTo.join(", ") : "everyone qualified"
      }. Back to the service desk`;
    default:
      return null;
  }
}

interface Comment {
  id: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

interface Worklog {
  id: string;
  engineerId: string;
  activityType: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  billable: boolean | null;
  notes: string | null;
  editReason: string | null;
}

interface Attachment {
  id: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

interface CiOption {
  id: string;
  ciCode: string;
  name: string;
}

interface EngineerOption {
  id: string;
  displayName: string;
  email: string;
}

interface GroupOption {
  id: string;
  name: string;
}

interface VendorCase {
  id: string;
  vendorCaseNo: string;
  vendorId: string;
  dispatchStatus: string | null;
  rmaRequired: boolean;
  closedAt: string | null;
}

interface LinkedAlert {
  id: string;
  source: string;
  alertType: string;
  severity: string;
  state: string;
  lastSeenAt: string;
}

const PRIORITY_COLOR: Record<string, "error" | "warning" | "info" | "default"> = {
  P1: "error",
  P2: "warning",
  P3: "info",
  P4: "default",
};

const ALERT_SEVERITY_COLOR: Record<string, "error" | "warning" | "info" | "default"> = {
  CRITICAL: "error",
  HIGH: "warning",
  WARNING: "info",
  INFO: "default",
};

function humanDuration(ms: number): string {
  const totalMinutes = Math.round(Math.abs(ms) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Load-time snapshot, not a live-ticking clock (plan Decision 5). */
function slaCountdown(
  dueAt: string | null,
  stoppedAt: string | null,
  pausedAt: string | null,
): string {
  if (!dueAt) return "—";
  if (stoppedAt)
    return `stopped (${humanDuration(Date.now() - new Date(stoppedAt).getTime())} ago)`;
  if (pausedAt) return "paused";
  const diffMs = new Date(dueAt).getTime() - Date.now();
  return diffMs < 0 ? `breached ${humanDuration(diffMs)} ago` : `due in ${humanDuration(diffMs)}`;
}

/**
 * Assign-to-engineer picker, used in both the edit panel and the transition
 * panel — each instance keeps its own query/options so picking a different
 * engineer while assigning doesn't affect what the edit panel shows. Scoped
 * to `siteId` server-side (GET /users?role=SITE_ENGINEER&siteId=...), same
 * "no q at all when empty" pattern as the CI picker so it lists the site's
 * whole engineer roster by default instead of requiring a name first.
 */
function EngineerPicker({
  siteId,
  value,
  onChange,
  label,
  disabled,
}: {
  siteId: string;
  value: EngineerOption | null;
  onChange: (value: EngineerOption | null) => void;
  label: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<EngineerOption[]>([]);

  useEffect(() => {
    const qParam = query ? `&q=${encodeURIComponent(query)}` : "";
    apiGet<EngineerOption[]>(`/users?role=SITE_ENGINEER&siteId=${siteId}${qParam}`)
      .then(setOptions)
      .catch(() => undefined);
  }, [query, siteId]);

  return (
    <Autocomplete
      options={options}
      getOptionLabel={(o) => `${o.displayName} (${o.email})`}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      value={value}
      onChange={(_, v) => onChange(v)}
      inputValue={query}
      onInputChange={(_, v) => setQuery(v)}
      disabled={disabled}
      openOnFocus
      noOptionsText="No engineers assigned to this site"
      renderInput={(params) => <TextField {...params} label={label} size="small" />}
    />
  );
}

/** Support groups are a short, site-independent list (GET /support-groups
 * has no query params at all) — client-side filtering is enough, no search
 * round-trip needed. `options` is fetched once at the page level and shared
 * by every instance instead of each picker re-fetching the same list. */
function GroupPicker({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: GroupOption[];
  value: GroupOption | null;
  onChange: (value: GroupOption | null) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Autocomplete
      options={options}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      value={value}
      onChange={(_, v) => onChange(v)}
      disabled={disabled}
      openOnFocus
      noOptionsText="No support groups yet"
      renderInput={(params) => <TextField {...params} label={label} size="small" />}
    />
  );
}

interface RoutingCandidate {
  userId: string;
  displayName: string;
  email: string;
  shiftLabel: string;
  isOnCall: boolean;
  openIncidentCount: number;
  isCurrentOwner: boolean;
}

interface RoutingSuggestions {
  requiredSkills: { id: string; name: string }[];
  candidates: RoutingCandidate[];
  reason:
    | "INCIDENT_NOT_OPEN"
    | "NO_SKILL_REQUIREMENTS"
    | "NO_ENGINEERS_ON_SHIFT"
    | "NO_QUALIFIED_ENGINEER"
    | null;
  uncoveredSkills: { id: string; name: string }[];
}

function routingEmptyMessage(s: RoutingSuggestions, category: string): string {
  switch (s.reason) {
    case "INCIDENT_NOT_OPEN":
      return "This incident is no longer open, so no routing suggestions are shown.";
    case "NO_SKILL_REQUIREMENTS":
      return `No skills are configured as required for category "${category}" — assign manually or to a group.`;
    case "NO_ENGINEERS_ON_SHIFT":
      return "Nobody is on shift at this site right now — assign manually or to a group queue.";
    case "NO_QUALIFIED_ENGINEER":
      return `Nobody on shift here has every required skill${
        s.uncoveredSkills.length
          ? ` (missing: ${s.uncoveredSkills.map((k) => k.name).join(", ")})`
          : ""
      } — assign manually or to a group queue.`;
    default:
      return "No suggestions.";
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/**
 * Skill-based routing suggestions (GET /incidents/:id/routing-suggestions),
 * rendered as its own side card next to Edit incident. "Assign" is a
 * one-click PATCH /incidents/:id with just ownerUserId — the same audited
 * reassign path Save changes uses, so the backend re-checks routing roles
 * and site scope regardless. Re-fetched when the category/status/owner
 * changes, not on every live-poll tick.
 */
function RoutingSuggestionsCard({
  incident,
  onAssigned,
}: {
  incident: Incident;
  onAssigned: (engineer: EngineerOption) => void;
}) {
  const [suggestions, setSuggestions] = useState<RoutingSuggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    apiGet<RoutingSuggestions>(`/incidents/${incident.id}/routing-suggestions`)
      .then(setSuggestions)
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [incident.id]);

  useEffect(load, [load, incident.category, incident.status, incident.ownerUserId]);

  const assign = async (c: RoutingCandidate) => {
    setAssigningId(c.userId);
    setAssignError(null);
    try {
      await apiPatch(`/incidents/${incident.id}`, { ownerUserId: c.userId });
      onAssigned({ id: c.userId, displayName: c.displayName, email: c.email });
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : String(err));
    } finally {
      setAssigningId(null);
    }
  };

  // Workload bars are relative to the busiest candidate shown, so they
  // compare engineers against each other rather than an arbitrary cap.
  const maxOpen = Math.max(1, ...(suggestions?.candidates.map((c) => c.openIncidentCount) ?? []));

  return (
    <Paper sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column" }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={1} alignItems="center">
          <PersonSearchOutlinedIcon color="primary" />
          <Typography variant="h6">Suggested engineers</Typography>
        </Stack>
        <Tooltip title="Refresh suggestions">
          <span>
            <IconButton size="small" onClick={load} disabled={loading} aria-label="Refresh">
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
        On shift at this site now and holding every required skill — least busy first.
      </Typography>
      {suggestions && suggestions.requiredSkills.length > 0 && (
        <Stack
          direction="row"
          spacing={0.5}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ mb: 1 }}
        >
          <Typography variant="body2" color="text.secondary">
            Needs
          </Typography>
          {suggestions.requiredSkills.map((k) => (
            <Chip key={k.id} size="small" variant="outlined" color="primary" label={k.name} />
          ))}
        </Stack>
      )}
      <Divider sx={{ mb: 1 }} />
      {loading && <LinearProgress sx={{ mb: 1 }} />}
      {assignError && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setAssignError(null)}>
          {assignError}
        </Alert>
      )}
      {loadError ? (
        <Alert severity="error">Could not load suggestions: {loadError}</Alert>
      ) : !suggestions ? (
        <Typography variant="body2" color="text.secondary">
          Loading...
        </Typography>
      ) : suggestions.candidates.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 3, px: 1 }}>
          <PersonOffOutlinedIcon color="disabled" sx={{ fontSize: 40 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {routingEmptyMessage(suggestions, incident.category)}
          </Typography>
          {suggestions.uncoveredSkills.length > 0 && (
            <Stack direction="row" spacing={0.5} justifyContent="center" sx={{ mt: 1 }}>
              {suggestions.uncoveredSkills.map((k) => (
                <Chip key={k.id} size="small" color="warning" label={`No ${k.name}`} />
              ))}
            </Stack>
          )}
        </Box>
      ) : (
        <List disablePadding sx={{ overflowY: "auto" }}>
          {suggestions.candidates.map((c, index) => (
            <ListItem
              key={c.userId}
              disableGutters
              divider={index < suggestions.candidates.length - 1}
              sx={{ alignItems: "flex-start", py: 1.25 }}
            >
              <ListItemAvatar sx={{ minWidth: 48 }}>
                <Avatar
                  sx={{
                    width: 36,
                    height: 36,
                    fontSize: 14,
                    bgcolor: c.isCurrentOwner ? severityColors.healthy : "primary.main",
                  }}
                >
                  {initials(c.displayName)}
                </Avatar>
              </ListItemAvatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {c.displayName}
                  </Typography>
                  {index === 0 && !c.isCurrentOwner && (
                    <Chip size="small" color="success" variant="outlined" label="Best match" />
                  )}
                </Stack>
                <Box sx={{ mt: 0.5 }}>
                  <Chip
                    size="small"
                    variant={c.isOnCall ? "filled" : "outlined"}
                    color={c.isOnCall ? "warning" : "default"}
                    label={c.isOnCall ? `On-call · ${c.shiftLabel}` : c.shiftLabel}
                  />
                </Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75 }}>
                  <LinearProgress
                    variant="determinate"
                    value={(c.openIncidentCount / maxOpen) * 100}
                    color={c.openIncidentCount === 0 ? "success" : "primary"}
                    sx={{ flex: 1, height: 6, borderRadius: 3 }}
                    aria-label={`${c.openIncidentCount} open incidents`}
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ whiteSpace: "nowrap" }}
                  >
                    {c.openIncidentCount} open
                  </Typography>
                </Stack>
              </Box>
              <Box sx={{ ml: 1, alignSelf: "center" }}>
                {c.isCurrentOwner ? (
                  <Chip
                    size="small"
                    color="success"
                    icon={<CheckCircleOutlineIcon />}
                    label="Owner"
                  />
                ) : (
                  <Button
                    size="small"
                    variant={index === 0 ? "contained" : "outlined"}
                    disabled={assigningId !== null}
                    onClick={() => assign(c)}
                  >
                    {assigningId === c.userId ? "Assigning…" : "Assign"}
                  </Button>
                )}
              </Box>
            </ListItem>
          ))}
        </List>
      )}
    </Paper>
  );
}

interface RoutingOffer {
  id: string;
  userId: string;
  displayName: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "CANCELLED";
  expiresAt: string;
  respondedAt: string | null;
  declineReason: string | null;
  createdAt: string;
}

interface IncidentRoutingOffers {
  incidentId: string;
  pending: RoutingOffer | null;
  history: RoutingOffer[];
}

const OFFER_POLL_MS = 4000;

function countdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function offerOutcome(o: RoutingOffer): string {
  switch (o.status) {
    case "DECLINED":
      return o.declineReason ? `declined: "${o.declineReason}"` : "declined";
    case "EXPIRED":
      return "didn't answer in time";
    case "CANCELLED":
      return "offer withdrawn";
    case "ACCEPTED":
      return "accepted";
    default:
      return "waiting";
  }
}

/**
 * Offer/accept routing (GET /incidents/:id/routing-offers). Three views:
 * the engineer the ticket is offered to gets Accept / Decline with a
 * countdown; everyone else sees who it's waiting on; and once nobody has
 * accepted, the desk sees who declined so it can assign by hand. Hidden
 * when the ticket has no offers. Polls while the ticket is still NEW so an
 * offer moving on shows up without a reload. Accept and decline are
 * re-checked by the backend (only the offered engineer can answer).
 */
function RoutingOfferBanner({
  incident,
  currentUserId,
  onChanged,
}: {
  incident: Incident;
  currentUserId: string | null;
  onChanged: () => void;
}) {
  const [offers, setOffers] = useState<IncidentRoutingOffers | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const isOpenNew = incident.status === "NEW" && !incident.ownerUserId && !incident.ownerGroupId;

  const load = useCallback(() => {
    apiGet<IncidentRoutingOffers>(`/incidents/${incident.id}/routing-offers`)
      .then((result) => {
        setOffers(result);
        setLoadError(null);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [incident.id]);

  useEffect(load, [load, incident.status, incident.ownerUserId, incident.ownerGroupId]);

  useEffect(() => {
    if (!isOpenNew) return undefined;
    const tick = () => {
      if (document.visibilityState === "visible") load();
    };
    const intervalId = window.setInterval(tick, OFFER_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [isOpenNew, load]);

  const pending = offers?.pending ?? null;
  useEffect(() => {
    if (!pending) return undefined;
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [pending]);

  const respond = async (kind: "accept" | "decline") => {
    setBusy(kind);
    setActionError(null);
    try {
      await apiPost(
        `/incidents/${incident.id}/routing-offers/${kind}`,
        kind === "decline" && reason.trim() ? { reason: reason.trim() } : undefined,
      );
      setDeclining(false);
      setReason("");
      load();
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      load();
    } finally {
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        Could not load routing offers: {loadError}
      </Alert>
    );
  }
  if (!offers || offers.history.length === 0) {
    return null;
  }

  const past = offers.history.filter((o) => o.status !== "PENDING" && o.status !== "ACCEPTED");
  const pastSummary = past.map((o) => `${o.displayName} (${offerOutcome(o)})`).join(", ");
  const msLeft = pending ? new Date(pending.expiresAt).getTime() - now : 0;

  if (pending && pending.userId === currentUserId) {
    return (
      <Paper
        sx={{
          p: 2,
          mb: 2,
          border: 2,
          borderColor: "warning.main",
          bgcolor: (theme) => alpha(theme.palette.warning.main, 0.06),
        }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems={{ xs: "stretch", sm: "center" }}
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <AssignmentIndOutlinedIcon color="warning" sx={{ mt: 0.25 }} />
            <Box>
              <Typography variant="h6">This ticket is offered to you</Typography>
              <Typography variant="body2" color="text.secondary">
                It matches your skills and your shift. Accept to take ownership, or decline so it
                goes to the next engineer.
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
            <Chip
              icon={<TimerOutlinedIcon />}
              color={msLeft < 60_000 ? "error" : "warning"}
              label={msLeft > 0 ? `${countdown(msLeft)} left` : "Expiring…"}
              sx={{ fontVariantNumeric: "tabular-nums" }}
            />
            <Button
              variant="contained"
              color="success"
              disabled={busy !== null || msLeft <= 0}
              onClick={() => respond("accept")}
            >
              {busy === "accept" ? "Accepting…" : "Accept"}
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              disabled={busy !== null || msLeft <= 0}
              onClick={() => setDeclining((d) => !d)}
            >
              Decline
            </Button>
          </Stack>
        </Stack>
        {declining && (
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems={{ xs: "stretch", sm: "flex-start" }}
            sx={{ mt: 2 }}
          >
            <TextField
              size="small"
              label="Reason (optional)"
              placeholder="e.g. On site at another data center"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              inputProps={{ maxLength: 500 }}
              sx={{ flex: 1 }}
            />
            <Button
              variant="contained"
              color="error"
              disabled={busy !== null}
              onClick={() => respond("decline")}
            >
              {busy === "decline" ? "Declining…" : "Confirm decline"}
            </Button>
          </Stack>
        )}
        {actionError && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setActionError(null)}>
            {actionError}
          </Alert>
        )}
      </Paper>
    );
  }

  if (pending) {
    return (
      <Alert severity="info" icon={<HourglassTopOutlinedIcon />} sx={{ mb: 2 }}>
        Offered to <strong>{pending.displayName}</strong>, waiting for them to accept (
        <Box component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>
          {msLeft > 0 ? `${countdown(msLeft)} left` : "expiring"}
        </Box>
        ).{pastSummary && ` Earlier: ${pastSummary}.`}
      </Alert>
    );
  }

  if (isOpenNew && past.length > 0) {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        No engineer accepted this ticket. Offered to {pastSummary}. Assign it manually below.
      </Alert>
    );
  }
  return null;
}

/**
 * Incident workspace (frontend-depth plan, Steps 3-4): header, SLA
 * countdown snapshot, status transition, comments, worklogs (add +
 * correct), attachments (upload + download), and a merged timeline.
 * Every write submits straight to its existing, already-authorized/
 * audited backend endpoint and refetches on success — no optimistic
 * local state. The transition dropdown doesn't mirror the rule table
 * client-side either (plan Decision 2) — it renders whatever
 * GET /incidents/:id/transitions computes from the one rule table the
 * transition endpoint itself enforces.
 */
export function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canRoute = INCIDENT_ROUTING_ROLES.includes(getCurrentUserRole() ?? "");
  const storedToken = getStoredToken();
  const currentUserId = storedToken ? (decodeJwtPayload(storedToken)?.sub ?? null) : null;
  const [incident, setIncident] = useState<Incident | null>(null);
  const [sla, setSla] = useState<SlaState | null>(null);
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [worklogs, setWorklogs] = useState<Worklog[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [availableTransitions, setAvailableTransitions] = useState<AvailableTransition[]>([]);
  const [vendorCases, setVendorCases] = useState<VendorCase[]>([]);
  const [linkedAlerts, setLinkedAlerts] = useState<LinkedAlert[]>([]);
  const [supportGroups, setSupportGroups] = useState<GroupOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Fetched once, not per-incident — the whole app shares one support-group
  // register (GET /support-groups isn't site-scoped, see support-groups.controller.ts).
  useEffect(() => {
    apiGet<GroupOption[]>("/support-groups")
      .then(setSupportGroups)
      .catch(() => undefined);
  }, []);

  // `silent: true` (the polling tick below) never touches `error` — a
  // transient network blip on a background refresh shouldn't blank out an
  // already-loaded ticket the user is actively looking at; it just tries
  // again next tick. Only the initial load and explicit user actions
  // (submitEdit, submitComment, etc., which all call refetch() bare) surface
  // a failure.
  const refetch = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!id) return;
      if (!opts?.silent) setError(null);
      Promise.all([
        apiGet<Incident>(`/incidents/${id}`),
        apiGet<SlaState | null>(`/incidents/${id}/sla`),
        apiGet<IncidentEvent[]>(`/incidents/${id}/events`),
        apiGet<Comment[]>(`/incidents/${id}/comments`),
        apiGet<Worklog[]>(`/incidents/${id}/worklogs`),
        apiGet<Attachment[]>(`/incidents/${id}/attachments`),
        apiGet<AvailableTransition[]>(`/incidents/${id}/transitions`),
        apiGet<VendorCase[]>(`/vendor-cases?linkedIncidentId=${id}`),
        apiGet<LinkedAlert[]>(`/alerts?correlatedIncidentId=${id}`),
      ])
        .then(([inc, slaState, evts, cmts, wls, atts, transitions, vCases, aAlerts]) => {
          setIncident(inc);
          setSla(slaState);
          setEvents(evts);
          setComments(cmts);
          setWorklogs(wls);
          setAttachments(atts);
          setAvailableTransitions(transitions);
          setVendorCases(vCases);
          setLinkedAlerts(aAlerts);
          setLastUpdatedAt(new Date());
        })
        .catch((err: Error) => {
          if (!opts?.silent) setError(err.message);
        });
    },
    [id],
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Live timeline (plan Decision: polling, not a WebSocket gateway — no
  // real-time transport exists anywhere in this codebase yet, and polling
  // gets every role watching a ticket the same "someone else just changed
  // this" experience without standing up new infrastructure this late).
  // Paused when the tab isn't visible so a background tab doesn't keep
  // hammering the API for a page nobody's looking at.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  useEffect(() => {
    if (!id) return undefined;
    const POLL_INTERVAL_MS = 4000;
    const tick = () => {
      if (document.visibilityState === "visible") {
        refetch({ silent: true });
      }
    };
    const intervalId = window.setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [id, refetch]);

  // --- Edit incident form --------------------------------------------------
  // Seeded from the incident once per incident id, not on every refetch, so
  // a mid-edit refetch (e.g. someone else posts a comment) doesn't clobber
  // what's being typed.
  const [editShortDescription, setEditShortDescription] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editImpact, setEditImpact] = useState("");
  const [editUrgency, setEditUrgency] = useState("");
  const [editPriority, setEditPriority] = useState("");
  const [editPriorityChangeReason, setEditPriorityChangeReason] = useState("");
  const [editOwnerUser, setEditOwnerUser] = useState<EngineerOption | null>(null);
  const [editOwnerGroup, setEditOwnerGroup] = useState<GroupOption | null>(null);
  const [ciQuery, setCiQuery] = useState("");
  const [ciOptions, setCiOptions] = useState<CiOption[]>([]);
  const [selectedCi, setSelectedCi] = useState<CiOption | null>(null);

  useEffect(() => {
    if (!incident) return;
    setEditShortDescription(incident.shortDescription);
    setEditCategory(incident.category);
    setEditImpact(incident.impact);
    setEditUrgency(incident.urgency);
    setEditPriority(incident.priority);
    setEditPriorityChangeReason("");
    // The incident only carries owner/CI ids, not readable names — resolve
    // each to show a name instead of a raw UUID. Not `refetch`'s problem to
    // fold in: this only needs to happen once per incident, same as
    // everything else in this effect.
    if (incident.ownerUserId) {
      apiGet<EngineerOption>(`/users/${incident.ownerUserId}`)
        .then(setEditOwnerUser)
        .catch(() => setEditOwnerUser(null));
    } else {
      setEditOwnerUser(null);
    }
    setEditOwnerGroup(
      incident.ownerGroupId
        ? (supportGroups.find((g) => g.id === incident.ownerGroupId) ?? null)
        : null,
    );
    if (incident.ciId) {
      apiGet<CiOption>(`/cis/${incident.ciId}`)
        .then(setSelectedCi)
        .catch(() => setSelectedCi(null));
    } else {
      setSelectedCi(null);
    }
    setCiQuery("");
    // Only re-seed when a different incident loads, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incident?.id, supportGroups]);

  useEffect(() => {
    if (!incident) {
      setCiOptions([]);
      return;
    }
    // No `q` filter at all when the field's empty — the backend already
    // treats that as "no filter" (cmdb.service.ts's findAll), so this
    // lists the site's whole CMDB inventory by default rather than
    // requiring the engineer to already know a code before anything shows.
    const qParam = ciQuery ? `&q=${encodeURIComponent(ciQuery)}` : "";
    apiGet<{ items: CiOption[] }>(`/cis?siteId=${incident.siteId}${qParam}`)
      .then((res) => setCiOptions(res.items))
      .catch(() => undefined);
  }, [ciQuery, incident]);

  const priorityChanged = incident !== null && editPriority !== incident.priority;

  const submitEdit = async () => {
    if (!id) return;
    setActionError(null);
    try {
      await apiPatch(`/incidents/${id}`, {
        shortDescription: editShortDescription,
        category: editCategory,
        impact: editImpact,
        urgency: editUrgency,
        // The backend requires priorityChangeReason whenever `priority` is
        // present in the body at all (spec §16), not just when it differs
        // from the current value — so only include the key when it's
        // actually being changed, same as priorityChangeReason itself.
        priority: priorityChanged ? editPriority : undefined,
        priorityChangeReason: priorityChanged ? editPriorityChangeReason : undefined,
        ciId: selectedCi?.id,
        ownerUserId: editOwnerUser?.id,
        ownerGroupId: editOwnerGroup?.id,
      });
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Transition form ---------------------------------------------------
  const [toStatus, setToStatus] = useState("");
  const [reason, setReason] = useState("");
  const [resolutionCategory, setResolutionCategory] = useState("");
  const [rootCauseSummary, setRootCauseSummary] = useState("");
  const [transitionOwnerUser, setTransitionOwnerUser] = useState<EngineerOption | null>(null);
  const [transitionOwnerGroup, setTransitionOwnerGroup] = useState<GroupOption | null>(null);
  const selectedTransition = availableTransitions.find((t) => t.toStatus === toStatus);
  const requiredFields = selectedTransition?.requiredFields ?? [];

  const submitTransition = async () => {
    if (!id || !toStatus) return;
    setActionError(null);
    try {
      await apiPost(`/incidents/${id}/transition`, {
        toStatus,
        reason: reason || undefined,
        resolutionCategory: resolutionCategory || undefined,
        rootCauseSummary: rootCauseSummary || undefined,
        ownerUserId: transitionOwnerUser?.id,
        ownerGroupId: transitionOwnerGroup?.id,
      });
      setToStatus("");
      setReason("");
      setResolutionCategory("");
      setRootCauseSummary("");
      setTransitionOwnerUser(null);
      setTransitionOwnerGroup(null);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Comment form --------------------------------------------------------
  const [commentBody, setCommentBody] = useState("");
  const [commentInternal, setCommentInternal] = useState(true);

  const submitComment = async () => {
    if (!id || !commentBody) return;
    setActionError(null);
    try {
      await apiPost(`/incidents/${id}/comments`, {
        body: commentBody,
        isInternal: commentInternal,
      });
      setCommentBody("");
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Worklog form ----------------------------------------------------
  const [activityType, setActivityType] = useState(WORKLOG_ACTIVITY_TYPES[0]);
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [worklogNotes, setWorklogNotes] = useState("");
  const [billable, setBillable] = useState(false);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [editReason, setEditReason] = useState("");

  const submitWorklog = async () => {
    if (!id || !startedAt) return;
    setActionError(null);
    try {
      await apiPost(`/incidents/${id}/worklogs`, {
        activityType,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: endedAt ? new Date(endedAt).toISOString() : undefined,
        notes: worklogNotes || undefined,
        billable,
      });
      setStartedAt("");
      setEndedAt("");
      setWorklogNotes("");
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const submitCorrection = async (worklogId: string) => {
    if (!editReason) return;
    setActionError(null);
    try {
      await apiPatch(`/worklogs/${worklogId}`, { editReason });
      setCorrectingId(null);
      setEditReason("");
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Attachments -------------------------------------------------------
  const uploadFile = async (file: File) => {
    if (!id) return;
    setActionError(null);
    try {
      await apiUpload(`/incidents/${id}/attachments`, file);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const downloadAttachment = async (attachmentId: string) => {
    if (!id) return;
    setActionError(null);
    try {
      const { url } = await apiGet<{ url: string }>(
        `/incidents/${id}/attachments/${attachmentId}/download`,
      );
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeAttachment = async (attachmentId: string) => {
    if (!id) return;
    if (!window.confirm("Remove this attachment? It won't be downloadable anymore.")) return;
    setActionError(null);
    try {
      await apiDelete(`/incidents/${id}/attachments/${attachmentId}`);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return (
      <Alert severity="error">
        Could not load incident {id}: {error}
      </Alert>
    );
  }
  if (!incident) {
    return <Typography color="text.secondary">Loading...</Typography>;
  }

  return (
    <Box>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 1 }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h5">{incident.incidentNo}</Typography>
              <Chip label={incident.status} />
              <Chip label={incident.priority} color={PRIORITY_COLOR[incident.priority]} />
            </Stack>
            {lastUpdatedAt && (
              <Tooltip title="This page refreshes automatically — status, assignment, comments and worklogs from anyone else appear here without reloading.">
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      bgcolor: severityColors.healthy,
                      animation: `${pulse} 2s ease-in-out infinite`,
                      "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Live · updated {lastUpdatedAt.toLocaleTimeString()}
                  </Typography>
                </Stack>
              </Tooltip>
            )}
          </Stack>
          <Typography variant="body1" sx={{ mb: 1 }}>
            {incident.shortDescription}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {incident.category} · impact {incident.impact} · urgency {incident.urgency}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Owner: {editOwnerUser?.displayName ?? (incident.ownerUserId ? "…" : "unassigned")}
            {" · "}
            Group: {editOwnerGroup?.name ?? (incident.ownerGroupId ? "…" : "unassigned")}
          </Typography>
          {sla && (
            <Typography variant="body2" component="div" sx={{ mt: 1 }}>
              Ack: {slaCountdown(sla.ackDueAt, sla.ackedAt, null)} · Resolve:{" "}
              {slaCountdown(sla.resolveDueAt, sla.resolvedAt, sla.pausedAt)}
              {sla.breached && (
                <Chip size="small" color="error" label="SLA BREACHED" sx={{ ml: 1 }} />
              )}
            </Typography>
          )}
        </CardContent>
      </Card>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <RoutingOfferBanner
        incident={incident}
        currentUserId={currentUserId}
        onChanged={() => refetch()}
      />

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={canRoute ? 8 : 12}>
          <Paper sx={{ p: 2, height: "100%" }}>
            <Typography variant="h6" gutterBottom>
              Edit incident
            </Typography>
            {!canRoute && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Reassigning ownership and overriding priority are a Service Desk/NOC or
                elevated-role call — you can still update the description, category, impact/urgency
                and affected CI.
              </Typography>
            )}
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Short description"
                  size="small"
                  fullWidth
                  value={editShortDescription}
                  onChange={(e) => setEditShortDescription(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Category"
                  size="small"
                  fullWidth
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField
                  select
                  label="Impact"
                  size="small"
                  fullWidth
                  value={editImpact}
                  onChange={(e) => setEditImpact(e.target.value)}
                >
                  {IMPACT_URGENCY_VALUES.map((v) => (
                    <MenuItem key={v} value={v}>
                      {v}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField
                  select
                  label="Urgency"
                  size="small"
                  fullWidth
                  value={editUrgency}
                  onChange={(e) => setEditUrgency(e.target.value)}
                >
                  {IMPACT_URGENCY_VALUES.map((v) => (
                    <MenuItem key={v} value={v}>
                      {v}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField
                  select
                  label="Priority"
                  size="small"
                  fullWidth
                  disabled={!canRoute}
                  helperText={!canRoute ? "Service Desk/NOC or elevated roles only" : undefined}
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value)}
                >
                  {PRIORITY_VALUES.map((v) => (
                    <MenuItem key={v} value={v}>
                      {v}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              {priorityChanged && (
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Reason for priority change"
                    size="small"
                    fullWidth
                    required
                    disabled={!canRoute}
                    value={editPriorityChangeReason}
                    onChange={(e) => setEditPriorityChangeReason(e.target.value)}
                  />
                </Grid>
              )}
              <Grid item xs={12}>
                <Autocomplete
                  options={ciOptions}
                  getOptionLabel={(o) => `${o.ciCode} — ${o.name}`}
                  isOptionEqualToValue={(o, v) => o.id === v.id}
                  value={selectedCi}
                  onChange={(_, value) => setSelectedCi(value)}
                  inputValue={ciQuery}
                  onInputChange={(_, value) => setCiQuery(value)}
                  openOnFocus
                  noOptionsText="No CIs found at this site"
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Affected CI (search by code or name, or click to browse)"
                      size="small"
                      helperText="Which server/rack/PDU this ticket is actually about — links it into the CMDB for alert correlation and history."
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <EngineerPicker
                  siteId={incident.siteId}
                  value={editOwnerUser}
                  onChange={setEditOwnerUser}
                  label="Owner (engineer)"
                  disabled={!canRoute}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <GroupPicker
                  options={supportGroups}
                  value={editOwnerGroup}
                  onChange={setEditOwnerGroup}
                  label="Owner group"
                  disabled={!canRoute}
                />
              </Grid>
              <Grid item xs={12}>
                <Button
                  variant="contained"
                  disabled={
                    !editShortDescription ||
                    !editCategory ||
                    (priorityChanged && !editPriorityChangeReason)
                  }
                  onClick={submitEdit}
                >
                  Save changes
                </Button>
              </Grid>
            </Grid>
          </Paper>
        </Grid>
        {canRoute && (
          <Grid item xs={12} md={4}>
            <RoutingSuggestionsCard
              incident={incident}
              onAssigned={(engineer) => {
                // Keep the Edit form's Owner field in step with the new
                // owner, so a later Save changes doesn't revert it.
                setEditOwnerUser(engineer);
                refetch();
              }}
            />
          </Grid>
        )}
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Change status
            </Typography>
            {availableTransitions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No status changes are available to you for this ticket right now — either its
                current status ({incident.status}) has no further moves, or none of them are your
                role's to make.
              </Typography>
            ) : (
              <Stack spacing={2}>
                <TextField
                  select
                  label="New status"
                  size="small"
                  value={toStatus}
                  onChange={(e) => setToStatus(e.target.value)}
                  helperText={
                    selectedTransition && !selectedTransition.allowed
                      ? selectedTransition.blockedReason
                      : undefined
                  }
                  error={selectedTransition ? !selectedTransition.allowed : false}
                >
                  {availableTransitions.map((t) => (
                    <MenuItem key={t.toStatus} value={t.toStatus} disabled={!t.allowed}>
                      {t.toStatus}
                      {!t.allowed && " (blocked)"}
                    </MenuItem>
                  ))}
                </TextField>
                {selectedTransition?.hint && (
                  <Alert severity="info">{selectedTransition.hint}</Alert>
                )}
                <TextField
                  label="Reason"
                  size="small"
                  required={requiredFields.includes("reason")}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <TextField
                  label="Resolution category"
                  size="small"
                  required={requiredFields.includes("resolutionCategory")}
                  value={resolutionCategory}
                  onChange={(e) => setResolutionCategory(e.target.value)}
                />
                <TextField
                  label="Root cause summary"
                  size="small"
                  multiline
                  required={requiredFields.includes("rootCauseSummary")}
                  value={rootCauseSummary}
                  onChange={(e) => setRootCauseSummary(e.target.value)}
                />
                <EngineerPicker
                  siteId={incident.siteId}
                  value={transitionOwnerUser}
                  onChange={setTransitionOwnerUser}
                  label="Assign to engineer"
                />
                <GroupPicker
                  options={supportGroups}
                  value={transitionOwnerGroup}
                  onChange={setTransitionOwnerGroup}
                  label="Assign to group"
                />
                <Button
                  variant="contained"
                  disabled={
                    !toStatus ||
                    selectedTransition?.allowed === false ||
                    requiredFields.some((f) =>
                      f === "reason"
                        ? !reason
                        : f === "resolutionCategory"
                          ? !resolutionCategory
                          : !rootCauseSummary,
                    )
                  }
                  onClick={submitTransition}
                >
                  Submit transition
                </Button>
              </Stack>
            )}
          </Paper>

          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Comments
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {comments.map((c) => (
                <Box key={c.id}>
                  <Typography variant="body2" component="div">
                    {c.body} {c.isInternal && <Chip size="small" label="internal" />}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {c.authorId} · {new Date(c.createdAt).toLocaleString()}
                  </Typography>
                  <Divider sx={{ mt: 1 }} />
                </Box>
              ))}
              {comments.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No comments yet.
                </Typography>
              )}
            </Stack>
            <TextField
              fullWidth
              multiline
              size="small"
              label="Add comment"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              sx={{ mb: 1 }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={commentInternal}
                  onChange={(e) => setCommentInternal(e.target.checked)}
                />
              }
              label="Internal (not customer-visible)"
            />
            <Button variant="contained" disabled={!commentBody} onClick={submitComment}>
              Post comment
            </Button>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Attachments
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {attachments.map((a) => (
                <Stack key={a.id} direction="row" spacing={2} alignItems="center">
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {a.objectKey.split("/").pop()} ({(a.sizeBytes / 1024).toFixed(1)} KB)
                  </Typography>
                  <Button size="small" onClick={() => downloadAttachment(a.id)}>
                    Download
                  </Button>
                  <Button size="small" color="error" onClick={() => removeAttachment(a.id)}>
                    Remove
                  </Button>
                </Stack>
              ))}
              {attachments.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No attachments yet.
                </Typography>
              )}
            </Stack>
            <Button component="label" variant="outlined">
              Upload file
              <input
                type="file"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadFile(file);
                  e.target.value = "";
                }}
              />
            </Button>
          </Paper>

          <Paper sx={{ p: 2, mt: 3 }}>
            <Typography variant="h6" gutterBottom>
              Vendor cases
            </Typography>
            <Stack spacing={1}>
              {vendorCases.map((vc) => (
                <Stack
                  key={vc.id}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  divider={<Divider orientation="vertical" flexItem />}
                >
                  <Link component={RouterLink} to={`/vendor-cases/${vc.id}`}>
                    {vc.vendorCaseNo}
                  </Link>
                  <Typography variant="body2" color="text.secondary">
                    {vc.dispatchStatus ?? "no dispatch yet"}
                  </Typography>
                  {vc.rmaRequired && <Chip size="small" label="RMA" />}
                  <Chip
                    size="small"
                    label={vc.closedAt ? "closed" : "open"}
                    color={vc.closedAt ? "default" : "warning"}
                  />
                </Stack>
              ))}
              {vendorCases.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No vendor cases linked to this ticket. Open one from the{" "}
                  <Link component={RouterLink} to="/vendors">
                    Vendors
                  </Link>{" "}
                  page and link this incident's ID.
                </Typography>
              )}
            </Stack>
          </Paper>

          <Paper sx={{ p: 2, mt: 3 }}>
            <Typography variant="h6" gutterBottom>
              Linked alerts
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Monitoring alerts the ingestion pipeline correlated to this ticket automatically — no
              manual step. New alerts on the same CI appear here as soon as the next poll picks them
              up.
            </Typography>
            <Stack spacing={1.5}>
              {linkedAlerts.map((a) => (
                <Box key={a.id}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Chip
                      size="small"
                      label={a.severity}
                      color={ALERT_SEVERITY_COLOR[a.severity] ?? "default"}
                    />
                    <Link component={RouterLink} to={`/alerts/${a.id}`}>
                      {a.alertType}
                    </Link>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={a.state}
                      color={a.state === "RECOVERED" ? "default" : "warning"}
                    />
                  </Stack>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {a.source} · last seen {new Date(a.lastSeenAt).toLocaleString()}
                  </Typography>
                  <Divider sx={{ mt: 1 }} />
                </Box>
              ))}
              {linkedAlerts.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No alerts linked to this ticket yet.
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Worklogs
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {worklogs.map((w) => (
                <Box key={w.id}>
                  <Typography variant="body2" component="div">
                    {w.activityType} — {new Date(w.startedAt).toLocaleString()}
                    {w.endedAt && ` → ${new Date(w.endedAt).toLocaleString()}`}
                    {w.durationMinutes !== null && ` (${w.durationMinutes}m)`}
                    {w.billable && <Chip size="small" label="billable" sx={{ ml: 1 }} />}
                  </Typography>
                  {w.notes && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {w.notes}
                    </Typography>
                  )}
                  {w.editReason && (
                    <Typography variant="caption" color="warning.main" display="block">
                      Corrected: {w.editReason}
                    </Typography>
                  )}
                  {correctingId === w.id ? (
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                      <TextField
                        size="small"
                        label="Reason for correction"
                        value={editReason}
                        onChange={(e) => setEditReason(e.target.value)}
                      />
                      <Button
                        size="small"
                        disabled={!editReason}
                        onClick={() => submitCorrection(w.id)}
                      >
                        Save
                      </Button>
                      <Button size="small" onClick={() => setCorrectingId(null)}>
                        Cancel
                      </Button>
                    </Stack>
                  ) : (
                    <Button size="small" onClick={() => setCorrectingId(w.id)}>
                      Correct
                    </Button>
                  )}
                  <Divider sx={{ mt: 1 }} />
                </Box>
              ))}
              {worklogs.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No worklogs yet.
                </Typography>
              )}
            </Stack>
            <Stack spacing={2}>
              <TextField
                select
                size="small"
                label="Activity type"
                value={activityType}
                onChange={(e) => setActivityType(e.target.value)}
              >
                {WORKLOG_ACTIVITY_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                type="datetime-local"
                size="small"
                label="Started at"
                InputLabelProps={{ shrink: true }}
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
              />
              <TextField
                type="datetime-local"
                size="small"
                label="Ended at (optional)"
                InputLabelProps={{ shrink: true }}
                value={endedAt}
                onChange={(e) => setEndedAt(e.target.value)}
              />
              <TextField
                size="small"
                label="Notes"
                value={worklogNotes}
                onChange={(e) => setWorklogNotes(e.target.value)}
              />
              <FormControlLabel
                control={
                  <Checkbox checked={billable} onChange={(e) => setBillable(e.target.checked)} />
                }
                label="Billable"
              />
              <Button variant="contained" disabled={!startedAt} onClick={submitWorklog}>
                Log time
              </Button>
            </Stack>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Timeline
            </Typography>
            <Stack spacing={1}>
              {events.map((e) => (
                <Box key={e.id}>
                  <Typography variant="body2">
                    <strong>{e.eventType}</strong> — {new Date(e.createdAt).toLocaleString()}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {describeRoutingEvent(e) ?? JSON.stringify(e.payload)}
                  </Typography>
                  <Divider sx={{ mt: 1 }} />
                </Box>
              ))}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
