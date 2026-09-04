import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  Grid,
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

// Literal unions mirroring the Prisma enums — same CJS/ESM-interop reason as
// IncidentsPage.tsx (shared-types can't be re-exported as ESM values here).
const VENDOR_TYPES = ["DELL", "HPE", "ISP", "LOCAL"];
const WARRANTY_STATUSES = ["ACTIVE", "EXPIRED", "UNKNOWN"];

interface Vendor {
  id: string;
  name: string;
  type: string;
  createdAt: string;
}

interface VendorCase {
  id: string;
  vendorCaseNo: string;
  vendorId: string;
  ciId: string | null;
  linkedIncidentId: string | null;
  warrantyStatus: string;
  dispatchStatus: string | null;
  rmaRequired: boolean;
  openedAt: string;
  closedAt: string | null;
}

interface WarrantyResyncSummary {
  checked: number;
  updated: number;
  unchanged: number;
  skipped: unknown[];
  failed: unknown[];
}

const WARRANTY_COLOR: Record<string, "success" | "error" | "default"> = {
  ACTIVE: "success",
  EXPIRED: "error",
  UNKNOWN: "default",
};

/**
 * Vendors + RMA workspace (spec §10.13) — the reference screen for the other
 * Dev B module pages. Vendor + case registers, a create form for each, the
 * on-demand warranty resync, and links into the per-case detail page. Every
 * write posts straight to its existing authorized/audited endpoint and
 * refetches; no optimistic local state.
 */
export function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [cases, setCases] = useState<VendorCase[]>([]);
  const [statusFilter, setStatusFilter] = useState<"open" | "closed" | "">("open");
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setError(null);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    Promise.all([
      apiGet<Vendor[]>("/vendors"),
      apiGet<VendorCase[]>(`/vendor-cases?${params.toString()}`),
    ])
      .then(([v, c]) => {
        setVendors(v);
        setCases(c);
      })
      .catch((err: Error) => setError(err.message));
  }, [statusFilter]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const vendorsById = Object.fromEntries(vendors.map((v) => [v.id, v.name]));

  // --- Create vendor ----------------------------------------------------
  const [vName, setVName] = useState("");
  const [vType, setVType] = useState(VENDOR_TYPES[0]);

  const createVendor = async () => {
    setActionError(null);
    try {
      await apiPost("/vendors", { name: vName, type: vType });
      setVName("");
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Open case ------------------------------------------------------------
  const [caseNo, setCaseNo] = useState("");
  const [caseVendorId, setCaseVendorId] = useState("");
  const [caseIncidentId, setCaseIncidentId] = useState("");
  const [caseCiId, setCaseCiId] = useState("");
  const [caseWarranty, setCaseWarranty] = useState("UNKNOWN");
  const [caseRma, setCaseRma] = useState(false);
  const [casePart, setCasePart] = useState("");

  const openCase = async () => {
    setActionError(null);
    try {
      await apiPost("/vendor-cases", {
        vendorCaseNo: caseNo,
        vendorId: caseVendorId,
        linkedIncidentId: caseIncidentId || undefined,
        ciId: caseCiId || undefined,
        warrantyStatus: caseWarranty,
        rmaRequired: caseRma,
        replacementPart: casePart || undefined,
      });
      setCaseNo("");
      setCaseIncidentId("");
      setCaseCiId("");
      setCasePart("");
      setCaseRma(false);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Warranty resync ---------------------------------------------------
  const runWarrantySync = async () => {
    setActionError(null);
    setSyncResult(null);
    try {
      const s = await apiPost<WarrantyResyncSummary>("/vendors/warranty-sync");
      setSyncResult(
        `Checked ${s.checked} · updated ${s.updated} · unchanged ${s.unchanged} · ` +
          `skipped ${s.skipped.length} · failed ${s.failed.length}`,
      );
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h4">Vendors &amp; RMA</Typography>
        <Button variant="outlined" onClick={runWarrantySync}>
          Run warranty sync
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load vendors: {error}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}
      {syncResult && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSyncResult(null)}>
          Warranty sync: {syncResult}
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Register a vendor
            </Typography>
            <Stack spacing={2}>
              <TextField
                size="small"
                label="Name"
                value={vName}
                onChange={(e) => setVName(e.target.value)}
              />
              <TextField
                select
                size="small"
                label="Type"
                value={vType}
                onChange={(e) => setVType(e.target.value)}
              >
                {VENDOR_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </TextField>
              <Button variant="contained" disabled={vName.length < 2} onClick={createVendor}>
                Add vendor
              </Button>
            </Stack>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Open a vendor case
            </Typography>
            <Stack spacing={2}>
              <TextField
                size="small"
                label="Vendor case no."
                value={caseNo}
                onChange={(e) => setCaseNo(e.target.value)}
              />
              <TextField
                select
                size="small"
                label="Vendor"
                value={caseVendorId}
                onChange={(e) => setCaseVendorId(e.target.value)}
              >
                {vendors.map((v) => (
                  <MenuItem key={v.id} value={v.id}>
                    {v.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="Linked incident ID (optional)"
                value={caseIncidentId}
                onChange={(e) => setCaseIncidentId(e.target.value)}
              />
              <TextField
                size="small"
                label="CI ID (optional)"
                value={caseCiId}
                onChange={(e) => setCaseCiId(e.target.value)}
              />
              <TextField
                select
                size="small"
                label="Warranty status"
                value={caseWarranty}
                onChange={(e) => setCaseWarranty(e.target.value)}
              >
                {WARRANTY_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="Replacement part (optional)"
                value={casePart}
                onChange={(e) => setCasePart(e.target.value)}
              />
              <FormControlLabel
                control={
                  <Checkbox checked={caseRma} onChange={(e) => setCaseRma(e.target.checked)} />
                }
                label="RMA required"
              />
              <Button
                variant="contained"
                disabled={!caseNo || !caseVendorId}
                onClick={openCase}
              >
                Open case
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={7}>
          <Typography variant="h6" gutterBottom>
            Vendors
          </Typography>
          <TableContainer component={Paper} sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Registered</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {vendors.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>{v.name}</TableCell>
                    <TableCell>{v.type}</TableCell>
                    <TableCell>{new Date(v.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
                {vendors.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography variant="body2" color="text.secondary">
                        No vendors registered yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
            <Typography variant="h6">Vendor cases</Typography>
            <TextField
              select
              size="small"
              label="Show"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "open" | "closed" | "")}
              sx={{ minWidth: 120 }}
            >
              <MenuItem value="open">Open</MenuItem>
              <MenuItem value="closed">Closed</MenuItem>
              <MenuItem value="">All</MenuItem>
            </TextField>
          </Stack>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Case</TableCell>
                  <TableCell>Vendor</TableCell>
                  <TableCell>Dispatch</TableCell>
                  <TableCell>Warranty</TableCell>
                  <TableCell>RMA</TableCell>
                  <TableCell>Opened</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link component={RouterLink} to={`/vendor-cases/${c.id}`}>
                        {c.vendorCaseNo}
                      </Link>
                    </TableCell>
                    <TableCell>{vendorsById[c.vendorId] ?? c.vendorId}</TableCell>
                    <TableCell>{c.dispatchStatus ?? "—"}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={c.warrantyStatus}
                        color={WARRANTY_COLOR[c.warrantyStatus] ?? "default"}
                      />
                    </TableCell>
                    <TableCell>{c.rmaRequired ? "Yes" : "No"}</TableCell>
                    <TableCell>{new Date(c.openedAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
                {cases.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary">
                        No {statusFilter || ""} vendor cases.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>
      </Grid>
    </>
  );
}
