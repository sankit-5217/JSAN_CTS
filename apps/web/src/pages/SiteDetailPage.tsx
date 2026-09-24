import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import AltRouteOutlinedIcon from "@mui/icons-material/AltRouteOutlined";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";

// Mirrors SitesController's SITE_MASTER_WRITE_ROLES — UI-only gate (plan
// Decision 1), same set used by SitesPage.tsx's "Create site" button minus
// the SUPER_ADMIN-only site-creation rule (contacts/calendars are wider).
const SITE_MASTER_WRITE_ROLES = ["SUPER_ADMIN", "DELIVERY_OPS_MANAGER", "INFRASTRUCTURE_LEAD"];
const WORKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Site {
  id: string;
  code: string;
  name: string;
  timezone: string;
  is247: boolean;
  status: string;
}

interface SiteContact {
  id: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  isOnCall: boolean;
}

interface SupportCalendar {
  id: string;
  name: string;
  businessStart: string;
  businessEnd: string;
  workdays: number[];
  holidays: string[];
  is247: boolean;
}

interface RoutingPolicy {
  siteId: string;
  autoAssignEnabled: boolean;
  offerTimeoutMinutes: number;
}

// Mirrors UpdateRoutingPolicyDto's bounds.
const MIN_OFFER_MINUTES = 1;
const MAX_OFFER_MINUTES = 120;

/**
 * Per-site skill-based routing switch (GET/PATCH /routing/policies/:siteId).
 * Loaded on its own, not in the page's Promise.all, so a failure here
 * never blanks the rest of the site page. Write gate mirrors
 * RoutingPoliciesController's ROUTING_POLICY_WRITE_ROLES (same set as
 * SITE_MASTER_WRITE_ROLES) — UI-only; the backend re-checks.
 */
function RoutingPolicyCard({ siteId, canWrite }: { siteId: string; canWrite: boolean }) {
  const [policy, setPolicy] = useState<RoutingPolicy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [minutesDraft, setMinutesDraft] = useState("");

  useEffect(() => {
    setLoadError(null);
    apiGet<RoutingPolicy>(`/routing/policies/${siteId}`)
      .then((p) => {
        setPolicy(p);
        setMinutesDraft(String(p.offerTimeoutMinutes));
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [siteId]);

  const save = async (changes: Partial<Omit<RoutingPolicy, "siteId">>) => {
    if (!policy) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await apiPatch<RoutingPolicy>(`/routing/policies/${siteId}`, {
        autoAssignEnabled: policy.autoAssignEnabled,
        offerTimeoutMinutes: policy.offerTimeoutMinutes,
        ...changes,
      });
      setPolicy(next);
      setMinutesDraft(String(next.offerTimeoutMinutes));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const minutes = Number(minutesDraft);
  const minutesValid =
    Number.isInteger(minutes) && minutes >= MIN_OFFER_MINUTES && minutes <= MAX_OFFER_MINUTES;
  const minutesChanged = policy !== null && minutes !== policy.offerTimeoutMinutes;

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <AltRouteOutlinedIcon color="primary" sx={{ mt: 0.5 }} />
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6">Auto-route new incidents</Typography>
              {policy && (
                <Chip
                  size="small"
                  color={policy.autoAssignEnabled ? "success" : "default"}
                  label={policy.autoAssignEnabled ? "On" : "Off"}
                />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Each new incident at this site is offered to the least-busy engineer who is on shift
              here and has every skill its category requires. It's assigned to them once they
              accept. If they decline or don't answer in time, it's offered to the next engineer. If
              nobody accepts, it stays NEW and the service desk is told to assign it.
            </Typography>
          </Box>
        </Stack>
        {policy && (
          <FormControlLabel
            control={
              <Switch
                checked={policy.autoAssignEnabled}
                disabled={!canWrite || saving}
                onChange={(e) => save({ autoAssignEnabled: e.target.checked })}
                inputProps={{ "aria-label": "Auto-route new incidents" }}
              />
            }
            label={saving ? "Saving…" : ""}
            sx={{ mr: 0, flexShrink: 0 }}
          />
        )}
      </Stack>
      {policy && (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          alignItems={{ xs: "stretch", sm: "center" }}
          sx={{ mt: 2, pl: { sm: 4.5 } }}
        >
          <TextField
            size="small"
            type="number"
            label="Time to accept (minutes)"
            value={minutesDraft}
            onChange={(e) => setMinutesDraft(e.target.value)}
            disabled={!canWrite || saving}
            error={!minutesValid}
            helperText={
              minutesValid
                ? "How long each engineer has before the offer moves on"
                : `Enter a whole number from ${MIN_OFFER_MINUTES} to ${MAX_OFFER_MINUTES}`
            }
            inputProps={{ min: MIN_OFFER_MINUTES, max: MAX_OFFER_MINUTES, step: 1 }}
            sx={{ width: { xs: "100%", sm: 260 } }}
          />
          {canWrite && minutesChanged && (
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                size="small"
                disabled={!minutesValid || saving}
                onClick={() => save({ offerTimeoutMinutes: minutes })}
              >
                Save
              </Button>
              <Button
                size="small"
                disabled={saving}
                onClick={() => setMinutesDraft(String(policy.offerTimeoutMinutes))}
              >
                Cancel
              </Button>
            </Stack>
          )}
        </Stack>
      )}
      {!policy && !loadError && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Loading...
        </Typography>
      )}
      {loadError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          Could not load the routing policy: {loadError}
        </Alert>
      )}
      {saveError && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      )}
      {policy && !canWrite && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Only Super Admin, Infrastructure Lead or Delivery/Ops Manager can change this.
        </Typography>
      )}
    </Paper>
  );
}

const emptyContactForm = { name: "", role: "", email: "", phone: "", isOnCall: false };
const emptyCalendarForm = {
  name: "",
  businessStart: "09:00",
  businessEnd: "18:00",
  workdays: [1, 2, 3, 4, 5] as number[],
  holidays: "",
  is247: false,
};

/**
 * Site workspace (admin-UI-gaps plan, Step 3) — the only place
 * POST /sites/:siteId/contacts and POST /sites/:siteId/support-calendars
 * are reachable from. Same parallel-fetch, refetch-on-write shape as
 * IncidentDetailPage.tsx / CiDetailPage.tsx.
 */
export function SiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [site, setSite] = useState<Site | null>(null);
  const [contacts, setContacts] = useState<SiteContact[]>([]);
  const [calendars, setCalendars] = useState<SupportCalendar[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canWrite = SITE_MASTER_WRITE_ROLES.includes(getCurrentUserRole() ?? "");

  const refetch = useCallback(() => {
    if (!id) return;
    setError(null);
    Promise.all([
      apiGet<Site>(`/sites/${id}`),
      apiGet<SiteContact[]>(`/sites/${id}/contacts`),
      apiGet<SupportCalendar[]>(`/sites/${id}/support-calendars`),
    ])
      .then(([siteData, contactData, calendarData]) => {
        setSite(siteData);
        setContacts(contactData);
        setCalendars(calendarData);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // --- Add contact ---------------------------------------------------------
  const [contactForm, setContactForm] = useState(emptyContactForm);

  const submitContact = async () => {
    if (!id) return;
    setActionError(null);
    try {
      await apiPost(`/sites/${id}/contacts`, {
        ...contactForm,
        email: contactForm.email || undefined,
        phone: contactForm.phone || undefined,
      });
      setContactForm(emptyContactForm);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Add support calendar -------------------------------------------------
  const [calendarForm, setCalendarForm] = useState(emptyCalendarForm);

  const toggleWorkday = (day: number) => {
    setCalendarForm((f) => ({
      ...f,
      workdays: f.workdays.includes(day)
        ? f.workdays.filter((d) => d !== day)
        : [...f.workdays, day].sort(),
    }));
  };

  const submitCalendar = async () => {
    if (!id) return;
    setActionError(null);
    try {
      const holidays = calendarForm.holidays
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean);
      await apiPost(`/sites/${id}/support-calendars`, {
        name: calendarForm.name,
        businessStart: calendarForm.businessStart,
        businessEnd: calendarForm.businessEnd,
        workdays: calendarForm.workdays,
        holidays: holidays.length > 0 ? holidays : undefined,
        is247: calendarForm.is247,
      });
      setCalendarForm(emptyCalendarForm);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return (
      <Alert severity="error">
        Could not load site {id}: {error}
      </Alert>
    );
  }
  if (!site) {
    return <Typography color="text.secondary">Loading...</Typography>;
  }

  return (
    <Box>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h5">{site.code}</Typography>
            <Chip label={site.status} />
            {site.is247 && <Chip label="24x7" color="info" />}
          </Stack>
          <Typography variant="body1">{site.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            Timezone: {site.timezone}
          </Typography>
        </CardContent>
      </Card>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <RoutingPolicyCard siteId={site.id} canWrite={canWrite} />

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Contacts
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {contacts.map((c) => (
                <Box key={c.id}>
                  <Typography variant="body2">
                    {c.name} — {c.role}{" "}
                    {c.isOnCall && <Chip size="small" label="on-call" sx={{ ml: 1 }} />}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {c.email ?? "—"} · {c.phone ?? "—"}
                  </Typography>
                  <Divider sx={{ mt: 1 }} />
                </Box>
              ))}
              {contacts.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No contacts yet.
                </Typography>
              )}
            </Stack>

            {canWrite && (
              <Stack spacing={2}>
                <TextField
                  label="Name"
                  size="small"
                  value={contactForm.name}
                  onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                />
                <TextField
                  label="Role / title"
                  size="small"
                  value={contactForm.role}
                  onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })}
                />
                <TextField
                  label="Email"
                  size="small"
                  value={contactForm.email}
                  onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                />
                <TextField
                  label="Phone"
                  size="small"
                  value={contactForm.phone}
                  onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={contactForm.isOnCall}
                      onChange={(e) =>
                        setContactForm({ ...contactForm, isOnCall: e.target.checked })
                      }
                    />
                  }
                  label="On-call"
                />
                <Button
                  variant="contained"
                  disabled={!contactForm.name || !contactForm.role}
                  onClick={submitContact}
                >
                  Add contact
                </Button>
              </Stack>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Support calendars
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {calendars.map((cal) => (
                <Box key={cal.id}>
                  <Typography variant="body2">
                    {cal.name} — {cal.is247 ? "24x7" : `${cal.businessStart}-${cal.businessEnd}`}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {cal.is247
                      ? "every day"
                      : cal.workdays.map((d) => WORKDAY_LABELS[d]).join(", ")}
                    {cal.holidays.length > 0 && ` · ${cal.holidays.length} holiday(s)`}
                  </Typography>
                  <Divider sx={{ mt: 1 }} />
                </Box>
              ))}
              {calendars.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No support calendars yet.
                </Typography>
              )}
            </Stack>

            {canWrite && (
              <Stack spacing={2}>
                <TextField
                  label="Name"
                  size="small"
                  value={calendarForm.name}
                  onChange={(e) => setCalendarForm({ ...calendarForm, name: e.target.value })}
                />
                <Stack direction="row" spacing={2}>
                  <TextField
                    label="Business start (HH:MM)"
                    size="small"
                    value={calendarForm.businessStart}
                    onChange={(e) =>
                      setCalendarForm({ ...calendarForm, businessStart: e.target.value })
                    }
                  />
                  <TextField
                    label="Business end (HH:MM)"
                    size="small"
                    value={calendarForm.businessEnd}
                    onChange={(e) =>
                      setCalendarForm({ ...calendarForm, businessEnd: e.target.value })
                    }
                  />
                </Stack>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Workdays
                  </Typography>
                  <Stack direction="row">
                    {WORKDAY_LABELS.map((label, day) => (
                      <FormControlLabel
                        key={day}
                        control={
                          <Checkbox
                            size="small"
                            checked={calendarForm.workdays.includes(day)}
                            onChange={() => toggleWorkday(day)}
                          />
                        }
                        label={label}
                      />
                    ))}
                  </Stack>
                </Box>
                <TextField
                  label="Holidays (comma-separated YYYY-MM-DD, optional)"
                  size="small"
                  value={calendarForm.holidays}
                  onChange={(e) => setCalendarForm({ ...calendarForm, holidays: e.target.value })}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={calendarForm.is247}
                      onChange={(e) =>
                        setCalendarForm({ ...calendarForm, is247: e.target.checked })
                      }
                    />
                  }
                  label="24x7 (ignores business hours/workdays)"
                />
                <Button variant="contained" disabled={!calendarForm.name} onClick={submitCalendar}>
                  Add support calendar
                </Button>
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
