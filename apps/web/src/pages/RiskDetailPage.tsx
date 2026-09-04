import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert as MuiAlert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Link,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { apiGet, apiPatch, apiPost } from "../api/client";

const RISK_STATUSES = ["OPEN", "MITIGATING", "ACCEPTED", "CLOSED"];

interface Risk {
  id: string;
  siteId: string | null;
  description: string;
  likelihood: number;
  impact: number;
  score: number;
  mitigation: string | null;
  ownerId: string | null;
  dueDate: string | null;
  status: string;
  severity: string;
  overdue: boolean;
}

const SEVERITY_COLOR: Record<string, "default" | "info" | "warning" | "error"> = {
  LOW: "default",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "error",
};

export function RiskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [risk, setRisk] = useState<Risk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!id) return;
    setError(null);
    apiGet<Risk>(`/risks/${id}`)
      .then(setRisk)
      .catch((err: Error) => setError(err.message));
  }, [id]);
  useEffect(() => {
    refetch();
  }, [refetch]);

  const [edit, setEdit] = useState<null | Record<string, string>>(null);
  const [toStatus, setToStatus] = useState("");
  const [statusMitigation, setStatusMitigation] = useState("");

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
        Could not load risk {id}: {error}
      </MuiAlert>
    );
  }
  if (!risk) {
    return <Typography color="text.secondary">Loading...</Typography>;
  }

  const startEdit = () =>
    setEdit({
      description: risk.description,
      likelihood: String(risk.likelihood),
      impact: String(risk.impact),
      mitigation: risk.mitigation ?? "",
      ownerId: risk.ownerId ?? "",
      dueDate: risk.dueDate ? risk.dueDate.slice(0, 10) : "",
    });

  return (
    <Box>
      <Link component={RouterLink} to="/risks" sx={{ display: "inline-block", mb: 2 }}>
        ← Risk register
      </Link>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h5">Risk</Typography>
            <Chip label={risk.severity} color={SEVERITY_COLOR[risk.severity] ?? "default"} />
            <Chip label={risk.status} />
            {risk.overdue && <Chip label="overdue" color="error" />}
          </Stack>
          <Typography variant="body1" sx={{ mb: 1 }}>
            {risk.description}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Likelihood {risk.likelihood} × impact {risk.impact} = score {risk.score} · Owner:{" "}
            {risk.ownerId ?? "—"} · Site: {risk.siteId ?? "—"} · Due:{" "}
            {risk.dueDate ? new Date(risk.dueDate).toLocaleDateString() : "—"}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            <strong>Mitigation:</strong> {risk.mitigation ?? "none recorded"}
          </Typography>
        </CardContent>
      </Card>

      {actionError && (
        <MuiAlert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </MuiAlert>
      )}

      <Grid container spacing={3}>
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
                  multiline
                  label="Description"
                  value={edit.description}
                  onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                />
                <Stack direction="row" spacing={2}>
                  <TextField
                    size="small"
                    type="number"
                    label="Likelihood"
                    value={edit.likelihood}
                    onChange={(e) => setEdit({ ...edit, likelihood: e.target.value })}
                  />
                  <TextField
                    size="small"
                    type="number"
                    label="Impact"
                    value={edit.impact}
                    onChange={(e) => setEdit({ ...edit, impact: e.target.value })}
                  />
                </Stack>
                <TextField
                  size="small"
                  multiline
                  label="Mitigation"
                  value={edit.mitigation}
                  onChange={(e) => setEdit({ ...edit, mitigation: e.target.value })}
                />
                <TextField
                  size="small"
                  label="Owner user id"
                  value={edit.ownerId}
                  onChange={(e) => setEdit({ ...edit, ownerId: e.target.value })}
                />
                <TextField
                  type="date"
                  size="small"
                  label="Due date"
                  InputLabelProps={{ shrink: true }}
                  value={edit.dueDate}
                  onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })}
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    onClick={() =>
                      call(
                        () =>
                          apiPatch(`/risks/${id}`, {
                            description: edit.description,
                            likelihood: Number(edit.likelihood),
                            impact: Number(edit.impact),
                            mitigation: edit.mitigation || undefined,
                            ownerId: edit.ownerId || undefined,
                            dueDate: edit.dueDate
                              ? new Date(edit.dueDate).toISOString()
                              : undefined,
                          }),
                        () => setEdit(null),
                      )
                    }
                  >
                    Save
                  </Button>
                  <Button onClick={() => setEdit(null)}>Cancel</Button>
                </Stack>
              </Stack>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Change status
            </Typography>
            <Stack spacing={2}>
              <TextField
                select
                size="small"
                label="New status"
                value={toStatus}
                onChange={(e) => setToStatus(e.target.value)}
              >
                {RISK_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                multiline
                label="Mitigation / rationale (required for MITIGATING / ACCEPTED)"
                value={statusMitigation}
                onChange={(e) => setStatusMitigation(e.target.value)}
              />
              <Button
                variant="contained"
                disabled={!toStatus}
                onClick={() =>
                  call(
                    () =>
                      apiPost(`/risks/${id}/status`, {
                        status: toStatus,
                        mitigation: statusMitigation || undefined,
                      }),
                    () => {
                      setToStatus("");
                      setStatusMitigation("");
                    },
                  )
                }
              >
                Apply
              </Button>
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
