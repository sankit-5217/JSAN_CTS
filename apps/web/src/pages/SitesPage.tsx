import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { ApiError, apiGet, apiPost } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";

interface Site {
  id: string;
  code: string;
  name: string;
  timezone: string;
  is247: boolean;
  status: string;
}

interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// Mirrors SitesController's site-creation rule: SUPER_ADMIN only (site
// master data is foundational platform config), narrower than contacts/
// calendars' SITE_MASTER_WRITE_ROLES on SiteDetailPage.tsx.
const emptySiteForm = { code: "", name: "", timezone: "Asia/Kolkata", is247: false };

/**
 * Reference screen exercising the sites module end-to-end (API -> Prisma ->
 * UI). Use this as the pattern for CMDB/incident list pages: server-side
 * pagination/sort/filter for large datasets is required once real data
 * volume shows up (spec §19) — this table is a Sprint 1 stub.
 */
export function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptySiteForm);
  const [createError, setCreateError] = useState<string | null>(null);
  const canWrite = getCurrentUserRole() === "SUPER_ADMIN";
  const [showArchived, setShowArchived] = useState(false);
  const [deleting, setDeleting] = useState<Site | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const restore = async (site: Site) => {
    setError(null);
    try {
      await apiPost(`/sites/${site.id}/restore`);
      setNotice(`${site.code} is restored and back in every list.`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submitCreate = async () => {
    setCreateError(null);
    try {
      await apiPost("/sites", createForm);
      setCreateOpen(false);
      setCreateForm(emptySiteForm);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    // limit=200: this page has no pagination UI yet (few sites per
    // deployment) -- fetch everything the backend's max page size allows
    // rather than defaulting to its first 50.
    apiGet<Paginated<Site>>(`/sites?limit=200${showArchived ? "&includeArchived=true" : ""}`)
      .then((res) => setSites(res.items))
      .catch((err: Error) => setError(err.message));
  }, [refreshKey, showArchived]);

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h4" gutterBottom>
          Sites
        </Typography>
        {canWrite && (
          <Button variant="contained" onClick={() => setCreateOpen(true)}>
            Create site
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {canWrite && (
        <FormControlLabel
          sx={{ mb: 1 }}
          control={
            <Checkbox checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          }
          label="Show deleted sites"
        />
      )}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Code</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Timezone</TableCell>
              <TableCell>24x7</TableCell>
              <TableCell>Status</TableCell>
              {canWrite && <TableCell align="right" />}
            </TableRow>
          </TableHead>
          <TableBody>
            {sites.map((site) => (
              <TableRow key={site.id}>
                <TableCell>
                  <Link component={RouterLink} to={`/sites/${site.id}`}>
                    {site.code}
                  </Link>
                </TableCell>
                <TableCell>{site.name}</TableCell>
                <TableCell>{site.timezone}</TableCell>
                <TableCell>{site.is247 ? "Yes" : "No"}</TableCell>
                <TableCell>
                  {site.status === "ARCHIVED" ? <Chip size="small" label="Deleted" /> : site.status}
                </TableCell>
                {canWrite && (
                  <TableCell align="right">
                    {site.status === "ARCHIVED" ? (
                      <Button size="small" onClick={() => void restore(site)}>
                        Restore
                      </Button>
                    ) : (
                      <Button size="small" color="error" onClick={() => setDeleting(site)}>
                        Delete
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {deleting && (
        <DeleteSiteDialog
          site={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setNotice(
              `${deleting.code} is deleted: hidden from lists and the client portal, and it takes no new tickets. Its history is kept; tick "Show deleted sites" to restore it.`,
            );
            setDeleting(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create site</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {createError && <Alert severity="error">{createError}</Alert>}
            <TextField
              label="Code"
              size="small"
              value={createForm.code}
              onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })}
            />
            <TextField
              label="Name"
              size="small"
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            />
            <TextField
              label="Timezone (IANA, e.g. Asia/Kolkata)"
              size="small"
              value={createForm.timezone}
              onChange={(e) => setCreateForm({ ...createForm, timezone: e.target.value })}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={createForm.is247}
                  onChange={(e) => setCreateForm({ ...createForm, is247: e.target.checked })}
                />
              }
              label="24x7 site"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!createForm.code || !createForm.name || !createForm.timezone}
            onClick={submitCreate}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** "Delete site" = archive: confirm, then show the API's reasons if it refuses (open tickets). */
function DeleteSiteDialog({
  site,
  onClose,
  onDone,
}: {
  site: Site;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [examples, setExamples] = useState<string[]>([]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    setExamples([]);
    try {
      await apiPost(`/sites/${site.id}/archive`);
      onDone();
    } catch (err) {
      const body =
        err instanceof ApiError
          ? (err.body as { message?: unknown; blockers?: { examples?: string[] }[] } | null)
          : null;
      setError(
        typeof body?.message === "string"
          ? body.message
          : err instanceof Error
            ? err.message
            : String(err),
      );
      setExamples(body?.blockers?.flatMap((b) => b.examples ?? []) ?? []);
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete site {site.code}?</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Typography variant="body2">
            {site.name} will disappear from site lists, pickers and the client portal, and nobody
            can raise new tickets on it. Its tickets, assets and history are kept, and you can
            restore it later.
          </Typography>
          {error && (
            <Alert severity="error">
              {error}
              {examples.length > 0 && <> ({examples.join(", ")})</>}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button color="error" variant="contained" onClick={() => void confirm()} disabled={busy}>
          {busy ? "Deleting…" : "Delete site"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
