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
  TextField,
  Typography,
} from "@mui/material";
import { apiGet, apiPost } from "../api/client";
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
