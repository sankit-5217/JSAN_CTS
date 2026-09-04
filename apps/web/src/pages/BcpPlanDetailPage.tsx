import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert as MuiAlert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { apiGet, apiPatch, apiPost } from "../api/client";

interface BcpPlan {
  id: string;
  name: string;
  siteId: string | null;
  serviceName: string | null;
  recoveryStrategy: string;
  alternateSite: string | null;
  rtoMinutes: number;
  rpoMinutes: number;
  targetAvailabilityPercent: number | null;
  residualRisk: string | null;
  contacts: string | null;
  ownerId: string | null;
  lastTestedAt: string | null;
  nextTestDueAt: string | null;
  isActive: boolean;
  readiness: string;
}

const READINESS_COLOR: Record<string, "default" | "warning" | "success"> = {
  UNTESTED: "default",
  DUE: "warning",
  READY: "success",
};

export function BcpPlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [plan, setPlan] = useState<BcpPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!id) return;
    setError(null);
    apiGet<BcpPlan>(`/bcp-plans/${id}`)
      .then(setPlan)
      .catch((err: Error) => setError(err.message));
  }, [id]);
  useEffect(() => {
    refetch();
  }, [refetch]);

  const [edit, setEdit] = useState<null | Record<string, string>>(null);
  const [testDate, setTestDate] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [testNotes, setTestNotes] = useState("");

  const call = async (fn: () => Promise<unknown>, reset?: () => void) => {
    setActionError(null);
    try {
      await fn();
      reset?.();
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return (
      <MuiAlert severity="error">
        Could not load plan {id}: {error}
      </MuiAlert>
    );
  }
  if (!plan) {
    return <Typography color="text.secondary">Loading...</Typography>;
  }

  const startEdit = () =>
    setEdit({
      name: plan.name,
      recoveryStrategy: plan.recoveryStrategy,
      alternateSite: plan.alternateSite ?? "",
      rtoMinutes: String(plan.rtoMinutes),
      rpoMinutes: String(plan.rpoMinutes),
      targetAvailabilityPercent:
        plan.targetAvailabilityPercent === null ? "" : String(plan.targetAvailabilityPercent),
      residualRisk: plan.residualRisk ?? "",
      contacts: plan.contacts ?? "",
      ownerId: plan.ownerId ?? "",
    });

  return (
    <Box>
      <Link component={RouterLink} to="/bcp-plans" sx={{ display: "inline-block", mb: 2 }}>
        ← All BCP plans
      </Link>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h5">{plan.name}</Typography>
            <Chip label={plan.readiness} color={READINESS_COLOR[plan.readiness] ?? "default"} />
            {!plan.isActive && <Chip label="retired" />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Covers: {plan.siteId ? `site ${plan.siteId}` : `service "${plan.serviceName}"`} · RTO{" "}
            {plan.rtoMinutes}m · RPO {plan.rpoMinutes}m
            {plan.targetAvailabilityPercent !== null &&
              ` · target ${plan.targetAvailabilityPercent}%`}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Alternate site: {plan.alternateSite ?? "—"} · Owner: {plan.ownerId ?? "—"}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Last tested:{" "}
            {plan.lastTestedAt ? new Date(plan.lastTestedAt).toLocaleDateString() : "never"} · Next
            due: {plan.nextTestDueAt ? new Date(plan.nextTestDueAt).toLocaleDateString() : "—"}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            <strong>Recovery strategy:</strong> {plan.recoveryStrategy}
          </Typography>
          {plan.residualRisk && (
            <Typography variant="body2">
              <strong>Residual risk:</strong> {plan.residualRisk}
            </Typography>
          )}
          {plan.contacts && (
            <Typography variant="body2">
              <strong>Contacts:</strong> {plan.contacts}
            </Typography>
          )}
        </CardContent>
      </Card>

      {actionError && (
        <MuiAlert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </MuiAlert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Log a test
            </Typography>
            <Stack spacing={2}>
              <TextField
                type="date"
                size="small"
                label="Tested on (blank = today)"
                InputLabelProps={{ shrink: true }}
                value={testDate}
                onChange={(e) => setTestDate(e.target.value)}
              />
              <TextField
                type="date"
                size="small"
                label="Next test due"
                InputLabelProps={{ shrink: true }}
                value={nextDue}
                onChange={(e) => setNextDue(e.target.value)}
              />
              <TextField
                size="small"
                multiline
                label="Result / evidence"
                value={testNotes}
                onChange={(e) => setTestNotes(e.target.value)}
              />
              <Button
                variant="contained"
                onClick={() =>
                  call(
                    () =>
                      apiPost(`/bcp-plans/${id}/tests`, {
                        testedAt: testDate ? new Date(testDate).toISOString() : undefined,
                        nextTestDueAt: nextDue ? new Date(nextDue).toISOString() : undefined,
                        notes: testNotes || undefined,
                      }),
                    () => {
                      setTestDate("");
                      setNextDue("");
                      setTestNotes("");
                    },
                  )
                }
              >
                Record test
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="h6">Edit</Typography>
              {!edit && (
                <Button size="small" onClick={startEdit}>
                  Edit
                </Button>
              )}
            </Stack>
            {edit && (
              <Stack spacing={2} sx={{ mt: 2 }}>
                <TextField
                  size="small"
                  label="Name"
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
                <TextField
                  size="small"
                  multiline
                  label="Recovery strategy"
                  value={edit.recoveryStrategy}
                  onChange={(e) => setEdit({ ...edit, recoveryStrategy: e.target.value })}
                />
                <TextField
                  size="small"
                  label="Alternate site"
                  value={edit.alternateSite}
                  onChange={(e) => setEdit({ ...edit, alternateSite: e.target.value })}
                />
                <Stack direction="row" spacing={2}>
                  <TextField
                    size="small"
                    type="number"
                    label="RTO (min)"
                    value={edit.rtoMinutes}
                    onChange={(e) => setEdit({ ...edit, rtoMinutes: e.target.value })}
                  />
                  <TextField
                    size="small"
                    type="number"
                    label="RPO (min)"
                    value={edit.rpoMinutes}
                    onChange={(e) => setEdit({ ...edit, rpoMinutes: e.target.value })}
                  />
                </Stack>
                <TextField
                  size="small"
                  type="number"
                  label="Target availability %"
                  value={edit.targetAvailabilityPercent}
                  onChange={(e) => setEdit({ ...edit, targetAvailabilityPercent: e.target.value })}
                />
                <TextField
                  size="small"
                  multiline
                  label="Residual risk"
                  value={edit.residualRisk}
                  onChange={(e) => setEdit({ ...edit, residualRisk: e.target.value })}
                />
                <TextField
                  size="small"
                  multiline
                  label="Contacts"
                  value={edit.contacts}
                  onChange={(e) => setEdit({ ...edit, contacts: e.target.value })}
                />
                <TextField
                  size="small"
                  label="Owner user id"
                  value={edit.ownerId}
                  onChange={(e) => setEdit({ ...edit, ownerId: e.target.value })}
                />
                <Divider />
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    onClick={() =>
                      call(
                        () =>
                          apiPatch(`/bcp-plans/${id}`, {
                            name: edit.name,
                            recoveryStrategy: edit.recoveryStrategy,
                            alternateSite: edit.alternateSite || undefined,
                            rtoMinutes: Number(edit.rtoMinutes),
                            rpoMinutes: Number(edit.rpoMinutes),
                            targetAvailabilityPercent: edit.targetAvailabilityPercent
                              ? Number(edit.targetAvailabilityPercent)
                              : undefined,
                            residualRisk: edit.residualRisk || undefined,
                            contacts: edit.contacts || undefined,
                            ownerId: edit.ownerId || undefined,
                          }),
                        () => setEdit(null),
                      )
                    }
                  >
                    Save
                  </Button>
                  <Button onClick={() => setEdit(null)}>Cancel</Button>
                  <Button
                    color="error"
                    onClick={() =>
                      call(
                        () => apiPatch(`/bcp-plans/${id}`, { isActive: !plan.isActive }),
                        () => setEdit(null),
                      )
                    }
                  >
                    {plan.isActive ? "Retire" : "Reactivate"}
                  </Button>
                </Stack>
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
