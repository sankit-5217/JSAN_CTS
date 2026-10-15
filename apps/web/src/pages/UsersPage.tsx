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
  FormControlLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
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
import { formatDateTime, formatTime } from "../time/clock";

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isActive: boolean;
  hasPassword: boolean;
  /** An admin set the password; they choose their own at next sign-in. */
  mustChangePassword: boolean;
  lockedUntil: string | null;
  allSites: boolean;
  siteIds: string[];
}

interface SignInLinkResult {
  link: string;
  expiresAt: string;
  purpose: "INVITE" | "RESET";
  emailQueued: boolean;
}

const MIN_PASSWORD = 12;

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
 * hides the link for everyone else). Sign-in is email + password only: an
 * admin adds someone with a starting password (they choose their own at first
 * sign-in) or emails them an invite link to choose one.
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
  const [linkFor, setLinkFor] = useState<{
    user: Pick<AdminUser, "id" | "displayName" | "email" | "hasPassword">;
    result?: SignInLinkResult;
  } | null>(null);
  const [tokensFor, setTokensFor] = useState<AdminUser | null>(null);
  const [passwordFor, setPasswordFor] = useState<AdminUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
            Add people (they get an email invite to choose a password) and manage their role, site
            access and status. Users are deactivated, never deleted.
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
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
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
                <TableCell>Sign-in</TableCell>
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
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {u.hasPassword && !u.mustChangePassword && (
                          <Chip size="small" variant="outlined" label="Password" />
                        )}
                        {u.mustChangePassword && (
                          <Tooltip title="Signs in with the password you set, then must choose their own.">
                            <Chip
                              size="small"
                              color="info"
                              variant="outlined"
                              label="Must change password"
                            />
                          </Tooltip>
                        )}
                        {!u.hasPassword && (
                          <Typography variant="caption" color="text.secondary">
                            Invite pending
                          </Typography>
                        )}
                        {u.lockedUntil && (
                          <Tooltip
                            title={`Too many wrong passwords — locked until ${formatTime(u.lockedUntil)}. Sending a reset link lets them in sooner.`}
                          >
                            <Chip size="small" color="warning" label="Locked" />
                          </Tooltip>
                        )}
                      </Stack>
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
                      {u.isActive && (
                        <Tooltip
                          title={
                            u.hasPassword
                              ? "Email a password reset link"
                              : "Email (or re-send) the invite to choose a password"
                          }
                        >
                          <Button size="small" onClick={() => setLinkFor({ user: u })}>
                            {u.hasPassword ? "Reset link" : "Invite"}
                          </Button>
                        </Tooltip>
                      )}
                      {u.isActive && !isSelf && (
                        <Tooltip title="Set their password yourself (no email); they choose their own at next sign-in">
                          <Button size="small" onClick={() => setPasswordFor(u)}>
                            Set password
                          </Button>
                        </Tooltip>
                      )}
                      <Tooltip title="API tokens for machine accounts (site collector, worker)">
                        <Button size="small" onClick={() => setTokensFor(u)}>
                          Tokens
                        </Button>
                      </Tooltip>
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
          onSaved={(created) => {
            setEditing(null);
            refetch();
            if (created?.invite) setLinkFor({ user: created, result: created.invite });
            else if (created) {
              setNotice(
                `${created.displayName} can now sign in as ${created.email} with the password you set. Tell them the password; they'll choose their own at first sign-in.`,
              );
            }
          }}
        />
      )}
      {linkFor && (
        <SignInLinkDialog
          user={linkFor.user}
          initialResult={linkFor.result}
          onClose={() => {
            setLinkFor(null);
            refetch();
          }}
        />
      )}
      {tokensFor && <ApiTokensDialog user={tokensFor} onClose={() => setTokensFor(null)} />}
      {passwordFor && (
        <SetPasswordDialog
          user={passwordFor}
          onClose={() => setPasswordFor(null)}
          onDone={() => {
            setNotice(
              `Password set for ${passwordFor.displayName}. They've been signed out and will choose their own at next sign-in.`,
            );
            setPasswordFor(null);
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
  onSaved: (created?: AdminUser & { invite: SignInLinkResult | null }) => void;
}) {
  const [method, setMethod] = useState<"password" | "invite">("password");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [role, setRole] = useState(user?.role ?? "SITE_ENGINEER");
  const [siteIds, setSiteIds] = useState<string[]>(user?.siteIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Blocker[]>([]);

  const allSites = ALL_SITES_ROLES.includes(role);
  const selectedSites = sites.filter((s) => siteIds.includes(s.id));
  const passwordOk =
    user !== null ||
    method === "invite" ||
    (password.length >= MIN_PASSWORD && confirm === password);
  const canSave = email.trim() !== "" && displayName.trim() !== "" && passwordOk && !saving;

  const save = async () => {
    setSaving(true);
    setError(null);
    setBlockers([]);
    try {
      if (!user) {
        const created = await apiPost<AdminUser & { invite: SignInLinkResult | null }>(
          "/admin/users",
          { email, displayName, role, siteIds, ...(method === "password" ? { password } : {}) },
        );
        onSaved(created);
        return;
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
            helperText={
              user
                ? "Changing it cancels any invite or reset link not used yet."
                : "They sign in with this email."
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
          {!user && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                How will they sign in?
              </Typography>
              <RadioGroup
                value={method}
                onChange={(e) => setMethod(e.target.value as "password" | "invite")}
              >
                <FormControlLabel
                  value="password"
                  control={<Radio size="small" />}
                  label="Set a starting password (I'll tell them; they change it at first sign-in)"
                />
                <FormControlLabel
                  value="invite"
                  control={<Radio size="small" />}
                  label="Email them an invite link to choose their own password"
                />
              </RadioGroup>
              {method === "password" && (
                <PasswordFields
                  password={password}
                  confirm={confirm}
                  onPassword={setPassword}
                  onConfirm={setConfirm}
                />
              )}
            </Box>
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

/** New password + confirmation, with the length rule shown as you type. */
function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
}) {
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  return (
    <Stack spacing={1.5} sx={{ mt: 1 }}>
      <TextField
        label="Starting password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => onPassword(e.target.value)}
        error={tooShort}
        helperText={`At least ${MIN_PASSWORD} characters. Share it with them securely (not in a group chat).`}
        fullWidth
      />
      <TextField
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => onConfirm(e.target.value)}
        error={mismatch}
        helperText={mismatch ? "Doesn't match" : " "}
        fullWidth
      />
    </Stack>
  );
}

/** Admin sets another user's password (no email): signs them out, change required at next sign-in. */
function SetPasswordDialog({
  user,
  onClose,
  onDone,
}: {
  user: AdminUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = password.length >= MIN_PASSWORD && confirm === password && !busy;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/admin/users/${user.id}/password`, { password });
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Set password for {user.displayName}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            {user.email} will be signed out everywhere and must choose their own password the next
            time they sign in. No email is sent.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <PasswordFields
            password={password}
            confirm={confirm}
            onPassword={setPassword}
            onConfirm={setConfirm}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={!canSave}>
          {busy ? "Saving…" : "Set password"}
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

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <TextField
      label={label}
      value={value}
      fullWidth
      size="small"
      InputProps={{
        readOnly: true,
        endAdornment: (
          <Button size="small" onClick={copy} sx={{ flexShrink: 0 }}>
            {copied ? "Copied" : "Copy"}
          </Button>
        ),
      }}
      onFocus={(e) => e.target.select()}
    />
  );
}

/** Confirm, then email an invite / reset link; always offers the link to copy as a fallback. */
function SignInLinkDialog({
  user,
  initialResult,
  onClose,
}: {
  user: Pick<AdminUser, "id" | "displayName" | "email" | "hasPassword">;
  initialResult?: SignInLinkResult;
  onClose: () => void;
}) {
  const [result, setResult] = useState<SignInLinkResult | null>(initialResult ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isReset = result ? result.purpose === "RESET" : user.hasPassword;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await apiPost<SignInLinkResult>(`/admin/users/${user.id}/sign-in-link`));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {isReset ? "Password reset link" : "Invite"} for {user.displayName}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {result ? (
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            {result.emailQueued ? (
              <Alert severity="success">
                Queued to email to {user.email}. The link works once and expires{" "}
                {formatDateTime(result.expiresAt)}. If it doesn&apos;t arrive, copy the link below
                and send it to them yourself.
              </Alert>
            ) : (
              <Alert severity="warning">
                The email couldn&apos;t be sent from here. Copy the link below and send it to{" "}
                {user.email} yourself (it expires {formatDateTime(result.expiresAt)}).
              </Alert>
            )}
            <CopyField label="Sign-in link (works once)" value={result.link} />
            <Typography variant="caption" color="text.secondary">
              Anyone with this link can set this account&apos;s password — share it only with{" "}
              {user.displayName}. Sending a new link cancels this one.
            </Typography>
          </Stack>
        ) : (
          <Typography variant="body2">
            {isReset
              ? `Email ${user.email} a link to choose a new password? It works once, for one hour.`
              : `Email ${user.email} an invite to choose a password? It works once, for 3 days.`}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {result ? "Done" : "Cancel"}
        </Button>
        {!result && (
          <Button variant="contained" onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send link"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

interface ApiTokenRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function tokenStatus(t: ApiTokenRow): { label: string; color: "success" | "default" | "warning" } {
  if (t.revokedAt) return { label: "Revoked", color: "default" };
  if (t.expiresAt && new Date(t.expiresAt) <= new Date()) {
    return { label: "Expired", color: "warning" };
  }
  return { label: "Active", color: "success" };
}

/** Long-lived tokens for machine accounts. The value is shown once, right after creation. */
function ApiTokensDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [tokens, setTokens] = useState<ApiTokenRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("365");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<ApiTokenRow[]>(`/admin/users/${user.id}/api-tokens`)
      .then(setTokens)
      .catch((err: Error) => setError(err.message));
  }, [user.id]);
  useEffect(load, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<ApiTokenRow & { token: string }>(
        `/admin/users/${user.id}/api-tokens`,
        { name: name.trim(), ...(expiry ? { expiresInDays: Number(expiry) } : {}) },
      );
      setCreated(res.token);
      setName("");
      load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (t: ApiTokenRow) => {
    if (!window.confirm(`Revoke "${t.name}"? Anything using it stops working immediately.`)) {
      return;
    }
    setError(null);
    try {
      await apiPost(`/admin/users/${user.id}/api-tokens/${t.id}/revoke`);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>API tokens for {user.displayName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            For machines that can&apos;t sign in, like a site collector or the worker. A token acts
            as {user.displayName} with their role and site access, and stops working if they&apos;re
            deactivated. Use a dedicated service account, not a person&apos;s account.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {created && (
            <Alert severity="success" onClose={() => setCreated(null)}>
              <Stack spacing={1}>
                <span>Copy this token now — it won&apos;t be shown again.</span>
                <CopyField label="API token" value={created} />
              </Stack>
            </Alert>
          )}
          {user.isActive && (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                size="small"
                label="What uses it (e.g. SITE01 collector)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                select
                size="small"
                label="Expires"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                sx={{ minWidth: 150 }}
              >
                <MenuItem value="90">In 90 days</MenuItem>
                <MenuItem value="365">In 1 year</MenuItem>
                <MenuItem value="">Never</MenuItem>
              </TextField>
              <Button variant="contained" onClick={create} disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create token"}
              </Button>
            </Stack>
          )}
          {tokens === null && !error ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
              <CircularProgress size={22} />
            </Box>
          ) : tokens && tokens.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No tokens yet.
            </Typography>
          ) : tokens ? (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Token</TableCell>
                    <TableCell>Created</TableCell>
                    <TableCell>Last used</TableCell>
                    <TableCell>Expires</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tokens.map((t) => {
                    const status = tokenStatus(t);
                    return (
                      <TableRow key={t.id}>
                        <TableCell>{t.name}</TableCell>
                        <TableCell sx={{ fontFamily: "monospace" }}>{t.prefix}…</TableCell>
                        <TableCell>{fmt(t.createdAt)}</TableCell>
                        <TableCell>{fmt(t.lastUsedAt)}</TableCell>
                        <TableCell>{t.expiresAt ? fmt(t.expiresAt) : "Never"}</TableCell>
                        <TableCell>
                          <Chip size="small" color={status.color} label={status.label} />
                        </TableCell>
                        <TableCell align="right">
                          {!t.revokedAt && (
                            <Button size="small" color="error" onClick={() => revoke(t)}>
                              Revoke
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
