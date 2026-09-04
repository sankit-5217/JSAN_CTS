import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { apiGet } from "../api/client";

// Mirrors the Prisma enums in apps/api/prisma/schema.prisma (CiType,
// Criticality, ManagedBy, LifecycleStatus) — literal string unions rather
// than importing @cts-dc-opsdesk/shared-types' runtime enums, same
// CJS/ESM-interop workaround as IncidentsPage.tsx (see its comment).
const CI_TYPES = ["SERVER", "FIREWALL", "SWITCH", "UPS", "PDU", "STORAGE", "SERVICE", "CIRCUIT", "VM"];
const CRITICALITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const MANAGED_BY = ["JSAN", "CTS", "SHARED", "VENDOR"];
const LIFECYCLE_STATUSES = ["PLANNED", "ACTIVE", "MAINTENANCE", "DECOMMISSIONED", "RETIRED"];

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
  }, [ciType, criticality, managedBy, lifecycleStatus, q]);

  return (
    <>
      <Typography variant="h4" gutterBottom>
        CMDB — Configuration Items
      </Typography>
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
                <TableCell>{item.ciCode}</TableCell>
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
    </>
  );
}
