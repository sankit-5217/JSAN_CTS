import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Button,
  Checkbox,
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
import { apiGet, apiPost } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";

interface Site {
  id: string;
  code: string;
  name: string;
  timezone: string;
  is247: boolean;
  status: string;
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
    apiGet<Site[]>("/sites")
      .then(setSites)
      .catch((err: Error) => setError(err.message));
  }, [refreshKey]);

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
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load sites: {error}
        </Alert>
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
                <TableCell>{site.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

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
