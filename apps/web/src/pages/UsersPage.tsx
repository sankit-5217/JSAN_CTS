import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
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
import { alpha } from "@mui/material/styles";
import PersonAddAltOutlinedIcon from "@mui/icons-material/PersonAddAltOutlined";
import { ApiError, apiGet, apiPatch, apiPost, apiPut, getStoredToken } from "../api/client";
import { decodeJwtPayload } from "../api/jwt";
import { roleMeta } from "../components/AccountMenu";

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isActive: boolean;
  ssoLinked: boolean;
  allSites: boolean;
  siteIds: string[];
}

interface Site {
  id: string;
  code: string;
  name: string;
}

interface Blocker {
  source: string;
  message: string;
  examples?: string[];
}

const ROLES = [
  "SUPER_ADMIN",
  "SERVICE_DESK_NOC",
  "SITE_ENGINEER",
  "INFRASTRUCTURE_LEAD",
  "VENDOR_COORDINATOR",
  "DELIVERY_OPS_MANAGER",
  "CLIENT_MANAGER_VIEWER",
  "AUDITOR_READ_ONLY",
];

// Mirrors the API's ALL_SITES_ROLES (auth/authz.service.ts) — these roles see
// every site, so the form doesn't offer site grants for them. Display only.
const ALL_SITES_ROLES = ["SUPER_ADMIN", "DELIVERY_OPS_MANAGER", "AUDITOR_READ_ONLY"];

type StatusFilter = "active" | "inactive" | "all";

function blockersOf(err: unknown): Blocker[] {
  if (err instanceof ApiError && err.status === 409) {
    const blockers = (err.body as { blockers?: Blocker[] } | null)?.blockers;
    if (Array.isArray(blockers)) return blockers;
  }
  return [];
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * User administration (Super Admin only — the API enforces it; the nav just
 * hides the link for everyone else). Provisioning here is what lets someone
 * sign in with SSO: logins only ever match users that already exist.
 */
export function UsersPage() {
  const currentUserId = decodeJwtPayload(getStoredToken() ?? "")?.sub ?? null;

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [roleFilter, setRoleFilter] = useState("");

  const [editing, setEditing] = useState<AdminUser | "new" | null>(null);
  const [toggling, setToggling] = useState<AdminUser | null>(null);

  const refetch = useCallback(() => {
    setError(null);
    const params = new URLSearchParams({ status });
    if (q.trim()) params.set("q", q.trim());
    if (roleFilter) params.set("role", roleFilter);
    apiGet<AdminUser[]>(`/admin/users?${params.toString()}`)
      .then(setUsers)
      .catch((err: Error) => setError(err.message));
  }, [q, status, roleFilter]);

  useEffect(() => {
    const handle = setTimeout(refetch, 250); // debounce typing in the search box
    return () => clearTimeout(handle);
  }, [refetch]);

  useEffect(() => {
    apiGet<{ items: Site[] }>("/sites?limit=200")
      .then((res) => setSites(res.items))
      .catch(() => setSites([]));
  }, []);

  const siteById = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);

  return (
    <Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Users
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Add people before they sign in with SSO, and manage their role, site access and status.
            Users are deactivated, never deleted.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<PersonAddAltOutlinedIcon />}
          onClick={() => setEditing("new")}
          sx={{ flexShrink: 0 }}
        >
          New user
        </Button>
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Search name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ minWidth: 260 }}
        />
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="active">Active</MenuItem>
          <MenuItem value="inactive">Inactive</MenuItem>
          <MenuItem value="all">All</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="Role"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          SelectProps={{ displayEmpty: true }}
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">All roles</MenuItem>
          {ROLES.map((r) => (
            <MenuItem key={r} value={r}>
              {roleMeta(r).label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Couldn't load users: {error}
        </Alert>
      )}

      {users === null && !error ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : users && users.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">No users match these filters.</Typography>
        </Paper>
      ) : users ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Site access</TableCell>
                <TableCell>SSO</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((u) => {
                const meta = roleMeta(u.role);
                const isSelf = u.id === currentUserId;
                return (
                  <TableRow key={u.id} hover sx={{ opacity: u.isActive ? 1 : 0.6 }}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {u.displayName}
                        {isSelf && (
                          <Typography component="span" variant="caption" color="text.secondary">
                            {" "}
                            (you)
                          </Typography>
                        )}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {u.email}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={meta.label}
                        sx={{
                          bgcolor: alpha(meta.color, 0.12),
                          color: meta.color,
                          fontWeight: 600,
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {u.allSites ? (
                        <Typography variant="body2">All sites</Typography>
                      ) : u.siteIds.length === 0 ? (
                        <Tooltip title="This role only sees sites it's granted — this user sees none.">
                          <Chip size="small" color="warning" variant="outlined" label="No sites" />
                        </Tooltip>
                      ) : (
                        <Typography variant="body2">
                          {u.siteIds.map((id) => siteById.get(id)?.code ?? "…").join(", ")}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {u.ssoLinked ? (
                        <Chip size="small" color="success" variant="outlined" label="Linked" />
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          Not signed in yet
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={u.isActive ? "Active" : "Inactive"}
                        color={u.isActive ? "success" : "default"}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      <Button size="small" onClick={() => setEditing(u)}>
                        Edit
                      </Button>
                      <Tooltip title={isSelf ? "You can't deactivate your own account" : ""}>
                        <span>
                          <Button
                            size="small"
                            color={u.isActive ? "error" : "primary"}
                            disabled={isSelf}
                            onClick={() => setToggling(u)}
                          >
                            {u.isActive ? "Deactivate" : "Reactivate"}
                          </Button>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}

      {editing && (
        <UserDialog
          user={editing === "new" ? null : editing}
          sites={sites}
          isSelf={editing !== "new" && editing.id === currentUserId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}
      {toggling && (
        <ToggleActiveDialog
          user={toggling}
          onClose={() => setToggling(null)}
          onDone={() => {
            setToggling(null);
            refetch();
          }}
        />
      )}
    </Box>
  );
}

function BlockerList({ blockers }: { blockers: Blocker[] }) {
  return (
    <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
      {blockers.map((b) => (
        <li key={b.source}>
          <Typography variant="body2">
            {b.message}
            {b.examples && b.examples.length > 0 && (
              <Typography component="span" variant="body2" color="text.secondary">
                {" "}
                ({b.examples.join(", ")})
              </Typography>
            )}
          </Typography>
        </li>
      ))}
    </Box>
  );
}

function UserDialog({
  user,
  sites,
  isSelf,
  onClose,
  onSaved,
}: {
  user: AdminUser | null;
  sites: Site[];
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState(user?.email ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [role, setRole] = useState(user?.role ?? "SITE_ENGINEER");
  const [siteIds, setSiteIds] = useState<string[]>(user?.siteIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);

  const allSites = ALL_SITES_ROLES.includes(role);
  const selectedSites = sites.filter((s) => siteIds.includes(s.id));
  const canSave = email.trim() !== "" && displayName.trim() !== "" && !saving;

  const save = async () => {
    setSaving(true);
    setError(null);
    setBlockers([]);
    try {
      if (!user) {
        await apiPost("/admin/users", { email, displayName, role, siteIds });
      } else {
        const patch: Record<string, string> = {};
        if (email.trim().toLowerCase() !== user.email) patch.email = email;
        if (displayName.trim() !== user.displayName) patch.displayName = displayName;
        if (role !== user.role) patch.role = role;
        if (Object.keys(patch).length > 0) {
          await apiPatch(`/admin/users/${user.id}`, patch);
        }
        const sameSites =
          siteIds.length === user.siteIds.length &&
          siteIds.every((id) => user.siteIds.includes(id));
        if (!sameSites) {
          await apiPut(`/admin/users/${user.id}/sites`, { siteIds });
        }
      }
      onSaved();
    } catch (err) {
      setBlockers(blockersOf(err));
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{user ? `Edit ${user.displayName}` : "New user"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && (
            <Alert severity="error">
              {blockers.length > 0 ? (
                <>
                  Can't save this change yet:
                  <BlockerList blockers={blockers} />
                </>
              ) : (
                error
              )}
            </Alert>
          )}
          <TextField
            label="Work email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={user?.ssoLinked}
            helperText={
              user?.ssoLinked
                ? "Locked: this user has signed in with SSO and is matched to that identity."
                : "Must match the email your SSO provider sends for this person."
            }
          />
          <TextField
            label="Display name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <TextField
            select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={isSelf}
            helperText={isSelf ? "You can't change your own role." : undefined}
          >
            {ROLES.map((r) => (
              <MenuItem key={r} value={r}>
                {roleMeta(r).label}
              </MenuItem>
            ))}
          </TextField>
          {allSites ? (
            <Alert severity="info">{roleMeta(role).label} sees every site; no grants needed.</Alert>
          ) : (
            <Autocomplete
              multiple
              options={sites}
              value={selectedSites}
              onChange={(_, value) => setSiteIds(value.map((s) => s.id))}
              getOptionLabel={(s) => `${s.code} — ${s.name}`}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Site access"
                  helperText={
                    siteIds.length === 0
                      ? "With no sites, this user won't see any site data."
                      : undefined
                  }
                />
              )}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={!canSave}>
          {saving ? "Saving…" : user ? "Save" : "Create user"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ToggleActiveDialog({
  user,
  onClose,
  onDone,
}: {
  user: AdminUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const deactivating = user.isActive;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    setBlockers([]);
    try {
      await apiPost(`/admin/users/${user.id}/${deactivating ? "deactivate" : "reactivate"}`);
      onDone();
    } catch (err) {
      setBlockers(blockersOf(err));
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {deactivating ? "Deactivate" : "Reactivate"} {user.displayName}?
      </DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error">
            {blockers.length > 0 ? (
              <>
                {user.displayName} can't be deactivated yet:
                <BlockerList blockers={blockers} />
              </>
            ) : (
              error
            )}
          </Alert>
        ) : (
          <Typography variant="body2">
            {deactivating
              ? "They'll be signed out immediately and can't sign in again until reactivated. Their history stays intact."
              : "They'll be able to sign in again with their existing role and site access."}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {blockers.length > 0 ? "Close" : "Cancel"}
        </Button>
        {blockers.length === 0 && (
          <Button
            variant="contained"
            color={deactivating ? "error" : "primary"}
            onClick={confirm}
            disabled={busy}
          >
            {busy ? "Working…" : deactivating ? "Deactivate" : "Reactivate"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
