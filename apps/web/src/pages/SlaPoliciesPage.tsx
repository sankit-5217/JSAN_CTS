import { useEffect, useState } from "react";
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
import { apiGet, apiPatch, apiPost } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";

// Mirrors SlaController's SLA_POLICY_WRITE_ROLES — UI-only gate (plan
// Decision 1); backend re-checks this regardless.
const SLA_POLICY_WRITE_ROLES = ["SUPER_ADMIN", "DELIVERY_OPS_MANAGER"];
const PRIORITIES = ["P1", "P2", "P3", "P4"];

interface SlaPolicy {
  id: string;
  name: string;
  priority: string;
  ackTargetMinutes: number;
  resolveTargetMinutes: number;
  usesBusinessCalendar: boolean;
  escalationThresholdsPercent: number[];
  pausesOnPendingVendor: boolean;
  pausesOnPendingCustomer: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

interface PolicyForm {
  name: string;
  priority: string;
  ackTargetMinutes: string;
  resolveTargetMinutes: string;
  usesBusinessCalendar: boolean;
  escalationThresholdsPercent: string;
  pausesOnPendingVendor: boolean;
  pausesOnPendingCustomer: boolean;
  effectiveFrom: string;
  effectiveTo: string;
  isActive: boolean;
}

const emptyForm: PolicyForm = {
  name: "",
  priority: PRIORITIES[0],
  ackTargetMinutes: "",
  resolveTargetMinutes: "",
  usesBusinessCalendar: false,
  escalationThresholdsPercent: "50,75,90",
  pausesOnPendingVendor: true,
  pausesOnPendingCustomer: true,
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: "",
  isActive: true,
};

function toIsoDate(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

/**
 * SLA policy admin (admin-UI-gaps plan, Step 4) — the only place
 * POST/PATCH /sla/policies are reachable from; every SLA target in the
 * system is otherwise only editable via curl/Swagger (spec's own
 * "config over hard-code" rule requires these live in the DB, not code).
 */
export function SlaPoliciesPage() {
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const canWrite = SLA_POLICY_WRITE_ROLES.includes(getCurrentUserRole() ?? "");

  useEffect(() => {
    apiGet<SlaPolicy[]>("/sla/policies")
      .then(setPolicies)
      .catch((err: Error) => setError(err.message));
  }, [refreshKey]);

  // --- Create/edit dialog (shared) -----------------------------------------
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PolicyForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (policy: SlaPolicy) => {
    setEditingId(policy.id);
    setForm({
      name: policy.name,
      priority: policy.priority,
      ackTargetMinutes: String(policy.ackTargetMinutes),
      resolveTargetMinutes: String(policy.resolveTargetMinutes),
      usesBusinessCalendar: policy.usesBusinessCalendar,
      escalationThresholdsPercent: policy.escalationThresholdsPercent.join(","),
      pausesOnPendingVendor: policy.pausesOnPendingVendor,
      pausesOnPendingCustomer: policy.pausesOnPendingCustomer,
      effectiveFrom: policy.effectiveFrom.slice(0, 10),
      effectiveTo: policy.effectiveTo ? policy.effectiveTo.slice(0, 10) : "",
      isActive: policy.isActive,
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const submit = async () => {
    setFormError(null);
    const escalationThresholdsPercent = form.escalationThresholdsPercent
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
    try {
      if (editingId) {
        await apiPatch(`/sla/policies/${editingId}`, {
          name: form.name,
          ackTargetMinutes: Number(form.ackTargetMinutes),
          resolveTargetMinutes: Number(form.resolveTargetMinutes),
          usesBusinessCalendar: form.usesBusinessCalendar,
          escalationThresholdsPercent,
          pausesOnPendingVendor: form.pausesOnPendingVendor,
          pausesOnPendingCustomer: form.pausesOnPendingCustomer,
          effectiveTo: form.effectiveTo ? toIsoDate(form.effectiveTo) : undefined,
          isActive: form.isActive,
        });
      } else {
        await apiPost("/sla/policies", {
          name: form.name,
          priority: form.priority,
          ackTargetMinutes: Number(form.ackTargetMinutes),
          resolveTargetMinutes: Number(form.resolveTargetMinutes),
          usesBusinessCalendar: form.usesBusinessCalendar,
          escalationThresholdsPercent,
          pausesOnPendingVendor: form.pausesOnPendingVendor,
          pausesOnPendingCustomer: form.pausesOnPendingCustomer,
          effectiveFrom: toIsoDate(form.effectiveFrom),
          effectiveTo: form.effectiveTo ? toIsoDate(form.effectiveTo) : undefined,
          isActive: form.isActive,
        });
      }
      setDialogOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h4" gutterBottom>
          SLA Policies
        </Typography>
        {canWrite && (
          <Button variant="contained" onClick={openCreate}>
            Create policy
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load SLA policies: {error}
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Priority</TableCell>
              <TableCell>Ack target</TableCell>
              <TableCell>Resolve target</TableCell>
              <TableCell>Calendar</TableCell>
              <TableCell>Escalation %</TableCell>
              <TableCell>Active</TableCell>
              {canWrite && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {policies.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.name}</TableCell>
                <TableCell>{p.priority}</TableCell>
                <TableCell>{p.ackTargetMinutes}m</TableCell>
                <TableCell>{p.resolveTargetMinutes}m</TableCell>
                <TableCell>{p.usesBusinessCalendar ? "Business hours" : "24x7"}</TableCell>
                <TableCell>{p.escalationThresholdsPercent.join(", ")}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={p.isActive ? "Active" : "Inactive"}
                    color={p.isActive ? "success" : "default"}
                  />
                </TableCell>
                {canWrite && (
                  <TableCell>
                    <Button size="small" onClick={() => openEdit(p)}>
                      Edit
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? "Edit SLA policy" : "Create SLA policy"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <TextField
              label="Name"
              size="small"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <TextField
              select
              label="Priority"
              size="small"
              disabled={!!editingId}
              helperText={
                editingId ? "Not editable — create a new versioned policy instead" : undefined
              }
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              {PRIORITIES.map((p) => (
                <MenuItem key={p} value={p}>
                  {p}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Ack target (minutes)"
                size="small"
                type="number"
                value={form.ackTargetMinutes}
                onChange={(e) => setForm({ ...form, ackTargetMinutes: e.target.value })}
              />
              <TextField
                label="Resolve target (minutes)"
                size="small"
                type="number"
                value={form.resolveTargetMinutes}
                onChange={(e) => setForm({ ...form, resolveTargetMinutes: e.target.value })}
              />
            </Stack>
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.usesBusinessCalendar}
                  onChange={(e) => setForm({ ...form, usesBusinessCalendar: e.target.checked })}
                />
              }
              label="Uses business-hours calendar (unchecked = 24x7 wall clock)"
            />
            <TextField
              label="Escalation thresholds (% of target elapsed, comma-separated)"
              size="small"
              value={form.escalationThresholdsPercent}
              onChange={(e) => setForm({ ...form, escalationThresholdsPercent: e.target.value })}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.pausesOnPendingVendor}
                  onChange={(e) => setForm({ ...form, pausesOnPendingVendor: e.target.checked })}
                />
              }
              label="Pauses while PENDING_VENDOR"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.pausesOnPendingCustomer}
                  onChange={(e) => setForm({ ...form, pausesOnPendingCustomer: e.target.checked })}
                />
              }
              label="Pauses while PENDING_CUSTOMER"
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="Effective from"
                size="small"
                type="date"
                disabled={!!editingId}
                InputLabelProps={{ shrink: true }}
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              />
              <TextField
                label="Effective to (optional)"
                size="small"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={form.effectiveTo}
                onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
              />
            </Stack>
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
              }
              label="Active"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!form.name || !form.ackTargetMinutes || !form.resolveTargetMinutes}
            onClick={submit}
          >
            {editingId ? "Save" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
