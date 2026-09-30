import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  FormGroup,
  Grid,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { keyframes } from "@mui/material/styles";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";
import { CategoryTeamsCard } from "../components/CategoryTeamsCard";
import { severityColors } from "../theme/theme";

// Mirrors ShiftsController's SHIFT_WRITE_ROLES — UI-only gate (same pattern
// as SupportGroupsPage/SlaPoliciesPage); the backend re-checks this regardless.
const SHIFT_WRITE_ROLES = ["SUPER_ADMIN", "INFRASTRUCTURE_LEAD", "DELIVERY_OPS_MANAGER"];

// Mirrors ENGINEER_ROLES in the API (auth/engineer-roles.ts): only these
// roles hold skills and work shifts.
const ENGINEER_ROLES = ["SITE_ENGINEER", "INFRASTRUCTURE_LEAD"];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;

interface Paginated<T> {
  items: T[];
}

interface Shift {
  id: string;
  userId: string;
  siteId: string;
  label: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  isOnCall: boolean;
  isActive: boolean;
}

interface RosterEntry {
  shiftId: string;
  label: string;
  isOnCall: boolean;
  siteId: string;
  siteCode: string;
  userId: string;
  displayName: string;
  email: string;
}

interface LiveRoster {
  asOf: string;
  working: RosterEntry[];
  onCall: RosterEntry[];
}

interface SiteOption {
  id: string;
  code: string;
  name: string;
}

interface UserOption {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

interface Skill {
  id: string;
  name: string;
  isActive: boolean;
}

interface SkillAssignment {
  id: string;
  userId: string;
  skillId: string;
  skill: Skill;
}

interface CategoryRequirement {
  id: string;
  category: string;
  skillId: string;
  skill: Skill;
}

function daysSummary(days: number[]): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d])
    .join(", ");
}

function RosterCard({ entry, siteName }: { entry: RosterEntry; siteName: string }) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      sx={{ py: 1, px: 1.25, borderRadius: 1, border: "1px solid", borderColor: "divider" }}
    >
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          bgcolor: entry.isOnCall ? "warning.main" : severityColors.healthy,
          flexShrink: 0,
        }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {entry.displayName}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {siteName} · {entry.label}
        </Typography>
      </Box>
    </Stack>
  );
}

/**
 * Real-time engineer coverage: who's on a working shift or on-call right
 * now, computed from the recurring weekly schedule (site-local time, not
 * activity/presence) — plus the schedule itself. Polls the live roster on
 * an interval, same pattern as IncidentDetailPage's live timeline, but
 * slower — shift status only changes at shift boundaries, not every few
 * seconds.
 */
export function ShiftsPage() {
  const canWrite = SHIFT_WRITE_ROLES.includes(getCurrentUserRole() ?? "");

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [staff, setStaff] = useState<UserOption[]>([]);
  const [roster, setRoster] = useState<LiveRoster | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [assignments, setAssignments] = useState<SkillAssignment[]>([]);
  const [newSkillName, setNewSkillName] = useState("");
  const [categoryRequirements, setCategoryRequirements] = useState<CategoryRequirement[]>([]);
  const [newReqCategory, setNewReqCategory] = useState("");
  const [newReqSkill, setNewReqSkill] = useState<Skill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const staffById = new Map(staff.map((u) => [u.id, u]));
  // The live roster is the backend's own authoritative "is this shift's
  // window open right now" computation (GET /shifts/live already applies
  // isShiftActiveAt in the site's timezone) — reuse it here instead of
  // reimplementing that time/timezone math client-side.
  const activeNowShiftIds = new Set(
    [...(roster?.working ?? []), ...(roster?.onCall ?? [])].map((e) => e.shiftId),
  );

  const refetchShifts = useCallback(() => {
    apiGet<Shift[]>("/shifts")
      .then(setShifts)
      .catch((err: Error) => setError(err.message));
  }, []);

  const refetchRoster = useCallback((opts?: { silent?: boolean }) => {
    apiGet<LiveRoster>("/shifts/live")
      .then(setRoster)
      .catch((err: Error) => {
        if (!opts?.silent) setError(err.message);
      });
  }, []);

  const refetchSkills = useCallback(() => {
    apiGet<Skill[]>("/skills")
      .then(setSkills)
      .catch(() => undefined);
  }, []);

  const refetchAssignments = useCallback(() => {
    apiGet<SkillAssignment[]>("/skills/assignments")
      .then(setAssignments)
      .catch(() => undefined);
  }, []);

  const refetchCategoryRequirements = useCallback(() => {
    apiGet<CategoryRequirement[]>("/skills/category-requirements")
      .then(setCategoryRequirements)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    apiGet<Paginated<SiteOption>>("/sites?limit=200")
      .then((res) => setSites(res.items))
      .catch(() => undefined);
    // Broad, query-less fetch for display-name lookups (table rows, roster
    // cards already carry their own displayName from the API) — kept
    // separate from the search-driven picker below, which only ever holds
    // whatever the current query matched.
    apiGet<UserOption[]>("/users?limit=200")
      .then(setStaff)
      .catch(() => undefined);
    refetchShifts();
    refetchRoster();
    refetchSkills();
    refetchAssignments();
    refetchCategoryRequirements();
  }, [
    refetchShifts,
    refetchRoster,
    refetchSkills,
    refetchAssignments,
    refetchCategoryRequirements,
  ]);

  useEffect(() => {
    const ROSTER_POLL_MS = 20_000;
    const tick = () => {
      if (document.visibilityState === "visible") {
        refetchRoster({ silent: true });
      }
    };
    const intervalId = window.setInterval(tick, ROSTER_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refetchRoster]);

  // --- New shift form ------------------------------------------------------
  const [formSite, setFormSite] = useState<SiteOption | null>(null);
  const [engineerQuery, setEngineerQuery] = useState("");
  const [engineerOptions, setEngineerOptions] = useState<UserOption[]>([]);
  const [formEngineer, setFormEngineer] = useState<UserOption | null>(null);
  const [formLabel, setFormLabel] = useState("");
  const [formDays, setFormDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [formStart, setFormStart] = useState("09:00");
  const [formEnd, setFormEnd] = useState("18:00");
  const [formOnCall, setFormOnCall] = useState(false);

  // Engineers only: shifts decide who routing can offer tickets to. The
  // backend rejects anyone else regardless.
  useEffect(() => {
    const qParam = engineerQuery ? `&q=${encodeURIComponent(engineerQuery)}` : "";
    apiGet<UserOption[]>(`/users?limit=50${qParam}`)
      .then((res) => setEngineerOptions(res.filter((u) => ENGINEER_ROLES.includes(u.role))))
      .catch(() => undefined);
  }, [engineerQuery]);

  const toggleFormDay = (day: number) => {
    setFormDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    );
  };

  const createShift = async () => {
    if (!formSite || !formEngineer || !formLabel || formDays.length === 0) return;
    setActionError(null);
    try {
      await apiPost("/shifts", {
        userId: formEngineer.id,
        siteId: formSite.id,
        label: formLabel,
        daysOfWeek: formDays,
        startTime: formStart,
        endTime: formEnd,
        isOnCall: formOnCall,
      });
      setFormLabel("");
      setFormEngineer(null);
      setEngineerQuery("");
      refetchShifts();
      refetchRoster();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleActive = async (shift: Shift) => {
    setActionError(null);
    try {
      await apiPatch(`/shifts/${shift.id}`, { isActive: !shift.isActive });
      refetchShifts();
      refetchRoster();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Skills --------------------------------------------------------------
  const createSkillTag = async () => {
    const name = newSkillName.trim();
    if (!name) return;
    setActionError(null);
    try {
      await apiPost("/skills", { name });
      setNewSkillName("");
      refetchSkills();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleSkillActive = async (skill: Skill) => {
    setActionError(null);
    try {
      await apiPatch(`/skills/${skill.id}`, { isActive: !skill.isActive });
      refetchSkills();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const assignSkillToEngineer = async (userId: string, skillId: string) => {
    setActionError(null);
    try {
      await apiPost(`/skills/${skillId}/engineers`, { userId });
      refetchAssignments();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const unassignSkillFromEngineer = async (userId: string, skillId: string) => {
    setActionError(null);
    try {
      await apiDelete(`/skills/${skillId}/engineers/${userId}`);
      refetchAssignments();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Category → skill requirements (Phase 2 of skill-based routing;
  // config only — nothing routes on this yet) --------------------------
  const createCategoryRequirement = async () => {
    const category = newReqCategory.trim();
    if (!category || !newReqSkill) return;
    setActionError(null);
    try {
      await apiPost("/skills/category-requirements", { category, skillId: newReqSkill.id });
      setNewReqCategory("");
      setNewReqSkill(null);
      refetchCategoryRequirements();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const deleteCategoryRequirement = async (id: string) => {
    setActionError(null);
    try {
      await apiDelete(`/skills/category-requirements/${id}`);
      refetchCategoryRequirements();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h4">Team &amp; Shifts</Typography>
        {roster && (
          <Tooltip title="Refreshes automatically — who's covering right now, based on the shift schedule below.">
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
                Live · updated {new Date(roster.asOf).toLocaleTimeString()}
              </Typography>
            </Stack>
          </Tooltip>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Who's actually on duty right now, computed from the recurring weekly shift schedule below —
        not a manual status anyone has to set.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load shifts: {error}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Working now
            </Typography>
            <Stack spacing={1}>
              {roster?.working.map((entry) => (
                <RosterCard
                  key={entry.shiftId}
                  entry={entry}
                  siteName={sitesById.get(entry.siteId)?.name ?? entry.siteCode}
                />
              ))}
              {roster && roster.working.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No one is on a scheduled working shift right now.
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              On call now
            </Typography>
            <Stack spacing={1}>
              {roster?.onCall.map((entry) => (
                <RosterCard
                  key={entry.shiftId}
                  entry={entry}
                  siteName={sitesById.get(entry.siteId)?.name ?? entry.siteCode}
                />
              ))}
              {roster && roster.onCall.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No on-call coverage scheduled right now.
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={canWrite ? 7 : 12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Shift schedule
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Engineer</TableCell>
                    <TableCell>Site</TableCell>
                    <TableCell>Shift</TableCell>
                    <TableCell>Days</TableCell>
                    <TableCell>Window</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>In window now</TableCell>
                    {canWrite && (
                      <TableCell>
                        <Tooltip title="Turn off to permanently retire this shift schedule — it stops counting toward Working now / On call now regardless of the clock.">
                          <span>Enabled</span>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {shifts.map((s) => {
                    const engineer = staffById.get(s.userId);
                    const inWindowNow = s.isActive && activeNowShiftIds.has(s.id);
                    return (
                      <TableRow key={s.id} sx={{ opacity: s.isActive ? 1 : 0.5 }}>
                        <TableCell>{engineer?.displayName ?? s.userId}</TableCell>
                        <TableCell>{sitesById.get(s.siteId)?.code ?? s.siteId}</TableCell>
                        <TableCell>{s.label}</TableCell>
                        <TableCell>{daysSummary(s.daysOfWeek)}</TableCell>
                        <TableCell>
                          {s.startTime}–{s.endTime}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={s.isOnCall ? "On-call" : inWindowNow ? "Working" : "Non-working"}
                            color={s.isOnCall ? "warning" : "default"}
                          />
                        </TableCell>
                        <TableCell>
                          {!s.isActive ? (
                            <Typography variant="caption" color="text.secondary">
                              Disabled
                            </Typography>
                          ) : (
                            <Chip
                              size="small"
                              label={inWindowNow ? "In window" : "Outside window"}
                              sx={
                                inWindowNow
                                  ? { bgcolor: severityColors.healthy, color: "#fffcfc" }
                                  : undefined
                              }
                              variant={inWindowNow ? "filled" : "outlined"}
                            />
                          )}
                        </TableCell>
                        {canWrite && (
                          <TableCell>
                            <Tooltip title="Manual enable/disable only — does not track the clock. Live coverage above is always automatic.">
                              <Switch
                                size="small"
                                checked={s.isActive}
                                onChange={() => toggleActive(s)}
                              />
                            </Tooltip>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {shifts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canWrite ? 8 : 7}>
                        <Typography variant="body2" color="text.secondary">
                          No shifts configured yet.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        {canWrite && (
          <Grid item xs={12} md={5}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                New shift
              </Typography>
              <Stack spacing={2}>
                <Autocomplete
                  options={sites}
                  getOptionLabel={(o) => `${o.code} — ${o.name}`}
                  isOptionEqualToValue={(o, v) => o.id === v.id}
                  value={formSite}
                  onChange={(_, v) => setFormSite(v)}
                  renderInput={(params) => <TextField {...params} label="Site" size="small" />}
                />
                <Autocomplete
                  options={engineerOptions}
                  getOptionLabel={(o) => `${o.displayName} (${o.email})`}
                  isOptionEqualToValue={(o, v) => o.id === v.id}
                  value={formEngineer}
                  onChange={(_, v) => setFormEngineer(v)}
                  inputValue={engineerQuery}
                  onInputChange={(_, v) => setEngineerQuery(v)}
                  openOnFocus
                  noOptionsText="No matching engineers"
                  renderInput={(params) => <TextField {...params} label="Engineer" size="small" />}
                />
                <TextField
                  label="Label"
                  size="small"
                  placeholder="Morning, Night, Weekend on-call…"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                />
                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ mb: 0.5 }}
                  >
                    Days (the day the shift starts on)
                  </Typography>
                  <FormGroup row>
                    {DAY_LABELS.map((label, day) => (
                      <FormControlLabel
                        key={day}
                        control={
                          <Checkbox
                            size="small"
                            checked={formDays.includes(day)}
                            onChange={() => toggleFormDay(day)}
                          />
                        }
                        label={label}
                      />
                    ))}
                  </FormGroup>
                </Box>
                <Stack direction="row" spacing={2}>
                  <TextField
                    type="time"
                    label="Start"
                    size="small"
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    value={formStart}
                    onChange={(e) => setFormStart(e.target.value)}
                  />
                  <TextField
                    type="time"
                    label="End"
                    size="small"
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    helperText={formStart === formEnd ? "Start and end can't match" : undefined}
                    error={formStart === formEnd}
                  />
                </Stack>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={formOnCall}
                      onChange={(e) => setFormOnCall(e.target.checked)}
                    />
                  }
                  label="On-call / escalation coverage (not a normal working shift)"
                />
                <Button
                  variant="contained"
                  disabled={
                    !formSite ||
                    !formEngineer ||
                    !formLabel ||
                    formDays.length === 0 ||
                    formStart === formEnd
                  }
                  onClick={createShift}
                >
                  Add shift
                </Button>
              </Stack>
            </Paper>
          </Grid>
        )}
      </Grid>

      <Grid container spacing={3} sx={{ mt: 0.5 }}>
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Skills
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              The skill tags engineers can be assigned. Foundation for skill-based incident routing
              — nothing routes automatically yet.
            </Typography>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
              {skills
                .filter((sk) => sk.isActive)
                .map((sk) => (
                  <Chip
                    key={sk.id}
                    label={sk.name}
                    color="primary"
                    variant="filled"
                    onDelete={canWrite ? () => toggleSkillActive(sk) : undefined}
                  />
                ))}
              {skills.every((sk) => !sk.isActive) && (
                <Typography variant="body2" color="text.secondary">
                  No skill tags yet.
                </Typography>
              )}
            </Stack>
            {skills.some((sk) => !sk.isActive) && (
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
                sx={{ mb: 1.5 }}
              >
                <Typography variant="caption" color="text.secondary">
                  Retired:
                </Typography>
                {skills
                  .filter((sk) => !sk.isActive)
                  .map((sk) => (
                    <Chip
                      key={sk.id}
                      size="small"
                      label={sk.name}
                      variant="outlined"
                      onClick={canWrite ? () => toggleSkillActive(sk) : undefined}
                      title={canWrite ? "Click to restore" : undefined}
                    />
                  ))}
              </Stack>
            )}

            {canWrite && (
              <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
                <TextField
                  size="small"
                  label="New skill tag"
                  placeholder="Windows, Storage, Backup…"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createSkillTag();
                  }}
                />
                <Button variant="outlined" onClick={createSkillTag} disabled={!newSkillName.trim()}>
                  Add tag
                </Button>
              </Stack>
            )}

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Engineer</TableCell>
                    <TableCell>Skills</TableCell>
                    {canWrite && <TableCell>Add skill</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {staff
                    .filter((u) => ENGINEER_ROLES.includes(u.role))
                    .sort((a, b) => a.displayName.localeCompare(b.displayName))
                    .map((u) => {
                      const userAssignments = assignments.filter((a) => a.userId === u.id);
                      const assignableSkills = skills.filter(
                        (sk) => sk.isActive && !userAssignments.some((a) => a.skillId === sk.id),
                      );
                      return (
                        <TableRow key={u.id}>
                          <TableCell>{u.displayName}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                              {userAssignments.map((a) => (
                                <Chip
                                  key={a.id}
                                  size="small"
                                  label={a.skill.name}
                                  onDelete={
                                    canWrite
                                      ? () => unassignSkillFromEngineer(u.id, a.skillId)
                                      : undefined
                                  }
                                />
                              ))}
                              {userAssignments.length === 0 && (
                                <Typography variant="caption" color="text.secondary">
                                  No skills assigned
                                </Typography>
                              )}
                            </Stack>
                          </TableCell>
                          {canWrite && (
                            <TableCell sx={{ minWidth: 180 }}>
                              <Autocomplete
                                size="small"
                                options={assignableSkills}
                                getOptionLabel={(sk) => sk.name}
                                value={null}
                                onChange={(_, v) => v && assignSkillToEngineer(u.id, v.id)}
                                noOptionsText="No more skills to add"
                                renderInput={(params) => (
                                  <TextField {...params} placeholder="Add skill…" />
                                )}
                              />
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  {!staff.some((u) => ENGINEER_ROLES.includes(u.role)) && (
                    <TableRow>
                      <TableCell colSpan={canWrite ? 3 : 2}>
                        <Typography variant="body2" color="text.secondary">
                          No engineers found. Only Site Engineers and Infrastructure Leads appear
                          here.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Category → skill requirements
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Which skill(s) an incident category needs — e.g. a "DATABASE" category requires the
              Database skill. Routing only offers a ticket to engineers who hold every required
              skill.
            </Typography>

            {canWrite && (
              <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="flex-start">
                <TextField
                  size="small"
                  label="Category"
                  placeholder="DATABASE, HARDWARE_FAILURE…"
                  value={newReqCategory}
                  onChange={(e) => setNewReqCategory(e.target.value)}
                />
                <Autocomplete
                  size="small"
                  sx={{ minWidth: 200 }}
                  options={skills.filter((sk) => sk.isActive)}
                  getOptionLabel={(sk) => sk.name}
                  isOptionEqualToValue={(o, v) => o.id === v.id}
                  value={newReqSkill}
                  onChange={(_, v) => setNewReqSkill(v)}
                  renderInput={(params) => <TextField {...params} label="Required skill" />}
                />
                <Button
                  variant="outlined"
                  onClick={createCategoryRequirement}
                  disabled={!newReqCategory.trim() || !newReqSkill}
                  sx={{ mt: 0.25 }}
                >
                  Add
                </Button>
              </Stack>
            )}

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Category</TableCell>
                    <TableCell>Required skill</TableCell>
                    {canWrite && <TableCell />}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {categoryRequirements.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell>{req.category}</TableCell>
                      <TableCell>
                        <Chip size="small" label={req.skill.name} />
                      </TableCell>
                      {canWrite && (
                        <TableCell align="right">
                          <Button
                            size="small"
                            color="error"
                            onClick={() => deleteCategoryRequirement(req.id)}
                          >
                            Remove
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {categoryRequirements.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canWrite ? 3 : 2}>
                        <Typography variant="body2" color="text.secondary">
                          No category skill requirements configured yet.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <CategoryTeamsCard canWrite={canWrite} />
        </Grid>
      </Grid>
    </Box>
  );
}
