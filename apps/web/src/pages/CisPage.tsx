import { useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
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
  Typography,
} from "@mui/material";
import { apiGet, apiPost } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";

// Mirrors the Prisma enums in apps/api/prisma/schema.prisma (CiType,
// Criticality, ManagedBy, LifecycleStatus) — literal string unions rather
// than importing @cts-dc-opsdesk/shared-types' runtime enums, same
// CJS/ESM-interop workaround as IncidentsPage.tsx (see its comment).
//
// LIFECYCLE_STATUSES previously included "DECOMMISSIONED", which isn't a
// LifecycleStatus enum value in schema.prisma (only PLANNED/ACTIVE/
// MAINTENANCE/RETIRED) — that filter option could never match anything.
const CI_TYPES = [
  "SERVER",
  "FIREWALL",
  "SWITCH",
  "UPS",
  "PDU",
  "STORAGE",
  "SERVICE",
  "CIRCUIT",
  "VM",
];
const CRITICALITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const MANAGED_BY = ["JSAN", "CTS", "SHARED", "VENDOR"];
const LIFECYCLE_STATUSES = ["PLANNED", "ACTIVE", "MAINTENANCE", "RETIRED"];

// Mirrors CisController's CMDB_WRITE_ROLES (apps/api/src/modules/cmdb/
// cmdb.controller.ts) — UI-only gate, backend re-checks this regardless.
const CMDB_WRITE_ROLES = [
  "SUPER_ADMIN",
  "DELIVERY_OPS_MANAGER",
  "INFRASTRUCTURE_LEAD",
  "SITE_ENGINEER",
];

const emptyCiForm = {
  ciCode: "",
  siteId: "",
  ciType: CI_TYPES[0],
  name: "",
  manufacturer: "",
  model: "",
  serialOrServiceTag: "",
  managementAddress: "",
  ownerGroupId: "",
  managedBy: MANAGED_BY[0],
  criticality: CRITICALITIES[0],
  lifecycleStatus: "ACTIVE",
};

interface ConfigurationItem {
  id: string;
  ciCode: string;
  siteId: string;
  ciType: string;
  name: string;
  criticality: string;
  managedBy: string;
  lifecycleStatus: string;
}

interface Paginated<T> {
  items: T[];
  total: number;
}

interface Site {
  id: string;
  code: string;
}

/**
 * CMDB inventory list (frontend-depth plan, Step 1) — a filtered table, not
 * a CI detail/relations view (Decision 1: not central to the ticketing
 * workflow the way incident detail is). Same querystring-driven pattern as
 * IncidentsPage.tsx.
 */
export function CisPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [cis, setCis] = useState<ConfigurationItem[]>([]);
  const [sitesById, setSitesById] = useState<Record<string, string>>({});
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCiForm);
  const [createError, setCreateError] = useState<string | null>(null);
  const canWrite = CMDB_WRITE_ROLES.includes(getCurrentUserRole() ?? "");

  const submitCreate = async () => {
    setCreateError(null);
    try {
      await apiPost("/cis", {
        ...createForm,
        manufacturer: createForm.manufacturer || undefined,
        model: createForm.model || undefined,
        serialOrServiceTag: createForm.serialOrServiceTag || undefined,
        managementAddress: createForm.managementAddress || undefined,
        ownerGroupId: createForm.ownerGroupId || undefined,
      });
      setCreateOpen(false);
      setCreateForm(emptyCiForm);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  const ciType = searchParams.get("ciType") ?? "";
  const criticality = searchParams.get("criticality") ?? "";
  const managedBy = searchParams.get("managedBy") ?? "";
  const lifecycleStatus = searchParams.get("lifecycleStatus") ?? "";
  const q = searchParams.get("q") ?? "";

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setSearchParams(next);
  };

  useEffect(() => {
    apiGet<Site[]>("/sites")
      .then((sites) => setSitesById(Object.fromEntries(sites.map((s) => [s.id, s.code]))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (ciType) params.set("ciType", ciType);
    if (criticality) params.set("criticality", criticality);
    if (managedBy) params.set("managedBy", managedBy);
    if (lifecycleStatus) params.set("lifecycleStatus", lifecycleStatus);
    if (q) params.set("q", q);

    apiGet<Paginated<ConfigurationItem>>(`/cis?${params.toString()}`)
      .then((res) => {
        setCis(res.items);
        setTotal(res.total);
      })
      .catch((err: Error) => setError(err.message));
  }, [ciType, criticality, managedBy, lifecycleStatus, q, refreshKey]);

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h4" gutterBottom>
          CMDB — Configuration Items
        </Typography>
        {canWrite && (
          <Button variant="contained" onClick={() => setCreateOpen(true)}>
            Create CI
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {total} result{total === 1 ? "" : "s"}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load configuration items: {error}
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 2, display: "flex", gap: 2, flexWrap: "wrap" }}>
        <TextField
          label="Search (code or name)"
          size="small"
          value={q}
          onChange={(e) => setFilter("q", e.target.value)}
          sx={{ minWidth: 220 }}
        />
        <TextField
          select
          label="Type"
          size="small"
          value={ciType}
          onChange={(e) => setFilter("ciType", e.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">All</MenuItem>
          {CI_TYPES.map((t) => (
            <MenuItem key={t} value={t}>
              {t}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Criticality"
          size="small"
          value={criticality}
          onChange={(e) => setFilter("criticality", e.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">All</MenuItem>
          {CRITICALITIES.map((c) => (
            <MenuItem key={c} value={c}>
              {c}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Managed by"
          size="small"
          value={managedBy}
          onChange={(e) => setFilter("managedBy", e.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">All</MenuItem>
          {MANAGED_BY.map((m) => (
            <MenuItem key={m} value={m}>
              {m}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Lifecycle"
          size="small"
          value={lifecycleStatus}
          onChange={(e) => setFilter("lifecycleStatus", e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          {LIFECYCLE_STATUSES.map((l) => (
            <MenuItem key={l} value={l}>
              {l}
            </MenuItem>
          ))}
        </TextField>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>CI Code</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Site</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Criticality</TableCell>
              <TableCell>Managed by</TableCell>
              <TableCell>Lifecycle</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {cis.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <Link component={RouterLink} to={`/cis/${item.id}`}>
                    {item.ciCode}
                  </Link>
                </TableCell>
                <TableCell>{item.name}</TableCell>
                <TableCell>{sitesById[item.siteId] ?? item.siteId}</TableCell>
                <TableCell>{item.ciType}</TableCell>
                <TableCell>{item.criticality}</TableCell>
                <TableCell>{item.managedBy}</TableCell>
                <TableCell>{item.lifecycleStatus}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create CI</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {createError && <Alert severity="error">{createError}</Alert>}
            <TextField
              label="CI code"
              size="small"
              value={createForm.ciCode}
              onChange={(e) => setCreateForm({ ...createForm, ciCode: e.target.value })}
            />
            <TextField
              select
              label="Site"
              size="small"
              value={createForm.siteId}
              onChange={(e) => setCreateForm({ ...createForm, siteId: e.target.value })}
            >
              {Object.entries(sitesById).map(([id, code]) => (
                <MenuItem key={id} value={id}>
                  {code}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Type"
              size="small"
              value={createForm.ciType}
              onChange={(e) => setCreateForm({ ...createForm, ciType: e.target.value })}
            >
              {CI_TYPES.map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Name"
              size="small"
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            />
            <TextField
              label="Manufacturer"
              size="small"
              value={createForm.manufacturer}
              onChange={(e) => setCreateForm({ ...createForm, manufacturer: e.target.value })}
            />
            <TextField
              label="Model"
              size="small"
              value={createForm.model}
              onChange={(e) => setCreateForm({ ...createForm, model: e.target.value })}
            />
            <TextField
              label="Serial / service tag"
              size="small"
              value={createForm.serialOrServiceTag}
              onChange={(e) => setCreateForm({ ...createForm, serialOrServiceTag: e.target.value })}
            />
            <TextField
              label="Management address (iDRAC/iLO IP)"
              size="small"
              value={createForm.managementAddress}
              onChange={(e) => setCreateForm({ ...createForm, managementAddress: e.target.value })}
            />
            <TextField
              label="Owner group ID (UUID)"
              size="small"
              value={createForm.ownerGroupId}
              onChange={(e) => setCreateForm({ ...createForm, ownerGroupId: e.target.value })}
            />
            <TextField
              select
              label="Managed by"
              size="small"
              value={createForm.managedBy}
              onChange={(e) => setCreateForm({ ...createForm, managedBy: e.target.value })}
            >
              {MANAGED_BY.map((m) => (
                <MenuItem key={m} value={m}>
                  {m}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Criticality"
              size="small"
              value={createForm.criticality}
              onChange={(e) => setCreateForm({ ...createForm, criticality: e.target.value })}
            >
              {CRITICALITIES.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Lifecycle status"
              size="small"
              value={createForm.lifecycleStatus}
              onChange={(e) => setCreateForm({ ...createForm, lifecycleStatus: e.target.value })}
            >
              {LIFECYCLE_STATUSES.map((l) => (
                <MenuItem key={l} value={l}>
                  {l}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!createForm.ciCode || !createForm.siteId || !createForm.name}
            onClick={submitCreate}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
