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
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api/client";

const PROBLEM_STATUSES = ["OPEN", "INVESTIGATING", "KNOWN_ERROR", "RESOLVED", "CLOSED"];
const PRIORITIES = ["P1", "P2", "P3", "P4"];
const LINK_TYPES = ["INCIDENT", "CHANGE"];

interface ActionItem {
  id: string;
  description: string;
  assigneeUserId: string | null;
  dueDate: string | null;
  completedAt: string | null;
}

interface ProblemLink {
  id: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

interface Problem {
  id: string;
  problemNo: string;
  title: string;
  status: string;
  priority: string | null;
  symptoms: string;
  knownError: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  preventiveAction: string | null;
  ownerUserId: string | null;
  dueDate: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  actionItems: ActionItem[];
  links: ProblemLink[];
}

const STATUS_COLOR: Record<string, "default" | "info" | "warning" | "success"> = {
  OPEN: "warning",
  INVESTIGATING: "info",
  KNOWN_ERROR: "default",
  RESOLVED: "success",
  CLOSED: "default",
};

export function ProblemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!id) return;
    setError(null);
    apiGet<Problem>(`/problems/${id}`)
      .then(setProblem)
      .catch((err: Error) => setError(err.message));
  }, [id]);
  useEffect(() => {
    refetch();
  }, [refetch]);

  const [edit, setEdit] = useState<null | Record<string, string>>(null);
  const [toStatus, setToStatus] = useState("");
  const [reason, setReason] = useState("");
  const [itemForm, setItemForm] = useState({ description: "", assigneeUserId: "", dueDate: "" });
  const [linkForm, setLinkForm] = useState({ entityType: "INCIDENT", entityId: "" });

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
        Could not load problem {id}: {error}
      </MuiAlert>
    );
  }
  if (!problem) {
    return <Typography color="text.secondary">Loading...</Typography>;
  }

  const startEdit = () =>
    setEdit({
      title: problem.title,
      priority: problem.priority ?? "",
      symptoms: problem.symptoms,
      knownError: problem.knownError ?? "",
      rootCause: problem.rootCause ?? "",
      correctiveAction: problem.correctiveAction ?? "",
      preventiveAction: problem.preventiveAction ?? "",
      ownerUserId: problem.ownerUserId ?? "",
      dueDate: problem.dueDate ? problem.dueDate.slice(0, 10) : "",
    });

  return (
    <Box>
      <Link component={RouterLink} to="/problems" sx={{ display: "inline-block", mb: 2 }}>
        ← Problems
      </Link>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h5">
              {problem.problemNo} — {problem.title}
            </Typography>
            <Chip label={problem.status} color={STATUS_COLOR[problem.status] ?? "default"} />
            {problem.priority && <Chip label={problem.priority} />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Owner: {problem.ownerUserId ?? "—"} · Due:{" "}
            {problem.dueDate ? new Date(problem.dueDate).toLocaleDateString() : "—"} · Resolved:{" "}
            {problem.resolvedAt ? new Date(problem.resolvedAt).toLocaleString() : "—"} · Closed:{" "}
            {problem.closedAt ? new Date(problem.closedAt).toLocaleString() : "—"}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            <strong>Symptoms:</strong> {problem.symptoms}
          </Typography>
          {problem.knownError && (
            <Typography variant="body2">
              <strong>Known error:</strong> {problem.knownError}
            </Typography>
          )}
          <Typography variant="body2">
            <strong>Root cause:</strong> {problem.rootCause ?? "not yet identified"}
          </Typography>
          {problem.correctiveAction && (
            <Typography variant="body2">
              <strong>Corrective action:</strong> {problem.correctiveAction}
            </Typography>
          )}
          {problem.preventiveAction && (
            <Typography variant="body2">
              <strong>Preventive action:</strong> {problem.preventiveAction}
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
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="h6">Edit RCA fields</Typography>
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
                  label="Title"
                  value={edit.title}
                  onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                />
                <TextField
                  select
                  size="small"
                  label="Priority"
                  value={edit.priority}
                  onChange={(e) => setEdit({ ...edit, priority: e.target.value })}
                >
                  <MenuItem value="">Unset</MenuItem>
                  {PRIORITIES.map((p) => (
                    <MenuItem key={p} value={p}>
                      {p}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  multiline
                  label="Symptoms"
                  value={edit.symptoms}
                  onChange={(e) => setEdit({ ...edit, symptoms: e.target.value })}
                />
                <TextField
                  size="small"
                  multiline
                  label="Known error"
                  value={edit.knownError}
                  onChange={(e) => setEdit({ ...edit, knownError: e.target.value })}
                />
                <TextField
                  size="small"
                  multiline
                  label="Root cause"
                  value={edit.rootCause}
                  onChange={(e) => setEdit({ ...edit, rootCause: e.target.value })}
                />
                <TextField
                  size="small"
                  multiline
                  label="Corrective action"
                  value={edit.correctiveAction}
                  onChange={(e) => setEdit({ ...edit, correctiveAction: e.target.value })}
                />
                <TextField
                  size="small"
                  multiline
                  label="Preventive action"
                  value={edit.preventiveAction}
                  onChange={(e) => setEdit({ ...edit, preventiveAction: e.target.value })}
                />
                <TextField
                  size="small"
                  label="Owner user id"
                  value={edit.ownerUserId}
                  onChange={(e) => setEdit({ ...edit, ownerUserId: e.target.value })}
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
                          apiPatch(`/problems/${id}`, {
                            title: edit.title,
                            priority: edit.priority || undefined,
                            symptoms: edit.symptoms,
                            knownError: edit.knownError || undefined,
                            rootCause: edit.rootCause || undefined,
                            correctiveAction: edit.correctiveAction || undefined,
                            preventiveAction: edit.preventiveAction || undefined,
                            ownerUserId: edit.ownerUserId || undefined,
                            dueDate: edit.dueDate ? new Date(edit.dueDate).toISOString() : undefined,
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

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Transition
            </Typography>
            <Stack spacing={2}>
              <TextField
                select
                size="small"
                label="New status"
                value={toStatus}
                onChange={(e) => setToStatus(e.target.value)}
              >
                {PROBLEM_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                multiline
                label="Reason (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                variant="contained"
                disabled={!toStatus}
                onClick={() =>
                  call(
                    () =>
                      apiPost(`/problems/${id}/transition`, {
                        toStatus,
                        reason: reason || undefined,
                      }),
                    () => {
                      setToStatus("");
                      setReason("");
                    },
                  )
                }
              >
                Apply
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Action items
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Description</TableCell>
                  <TableCell>Assignee</TableCell>
                  <TableCell>Due</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {problem.actionItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.description}</TableCell>
                    <TableCell>{item.assigneeUserId ?? "—"}</TableCell>
                    <TableCell>
                      {item.dueDate ? new Date(item.dueDate).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>
                      {item.completedAt ? (
                        <Chip size="small" color="success" label="done" />
                      ) : (
                        <Button
                          size="small"
                          onClick={() =>
                            call(() => apiPatch(`/problems/${id}/action-items/${item.id}`, {}))
                          }
                        >
                          Mark done
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {problem.actionItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary">
                        No action items yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <Divider sx={{ my: 2 }} />
            <Stack spacing={2}>
              <TextField
                size="small"
                label="Description"
                value={itemForm.description}
                onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  size="small"
                  label="Assignee user id (optional)"
                  value={itemForm.assigneeUserId}
                  onChange={(e) => setItemForm({ ...itemForm, assigneeUserId: e.target.value })}
                  fullWidth
                />
                <TextField
                  type="date"
                  size="small"
                  label="Due (optional)"
                  InputLabelProps={{ shrink: true }}
                  value={itemForm.dueDate}
                  onChange={(e) => setItemForm({ ...itemForm, dueDate: e.target.value })}
                />
              </Stack>
              <Button
                variant="outlined"
                disabled={itemForm.description.length < 3}
                onClick={() =>
                  call(
                    () =>
                      apiPost(`/problems/${id}/action-items`, {
                        description: itemForm.description,
                        assigneeUserId: itemForm.assigneeUserId || undefined,
                        dueDate: itemForm.dueDate
                          ? new Date(itemForm.dueDate).toISOString()
                          : undefined,
                      }),
                    () => setItemForm({ description: "", assigneeUserId: "", dueDate: "" }),
                  )
                }
              >
                Add action item
              </Button>
            </Stack>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Linked incidents / changes
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell>Id</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {problem.links.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.entityType}</TableCell>
                    <TableCell>
                      {l.entityType === "INCIDENT" ? (
                        <Link component={RouterLink} to={`/incidents/${l.entityId}`}>
                          {l.entityId}
                        </Link>
                      ) : (
                        <Link component={RouterLink} to={`/changes/${l.entityId}`}>
                          {l.entityId}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        onClick={() => call(() => apiDelete(`/problems/${id}/links/${l.id}`))}
                      >
                        Unlink
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {problem.links.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography variant="body2" color="text.secondary">
                        Nothing linked yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" spacing={2}>
              <TextField
                select
                size="small"
                label="Type"
                value={linkForm.entityType}
                onChange={(e) => setLinkForm({ ...linkForm, entityType: e.target.value })}
                sx={{ minWidth: 140 }}
              >
                {LINK_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="Id"
                value={linkForm.entityId}
                onChange={(e) => setLinkForm({ ...linkForm, entityId: e.target.value })}
                fullWidth
              />
              <Button
                variant="outlined"
                disabled={!linkForm.entityId}
                onClick={() =>
                  call(
                    () => apiPost(`/problems/${id}/links`, linkForm),
                    () => setLinkForm({ entityType: "INCIDENT", entityId: "" }),
                  )
                }
              >
                Link
              </Button>
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
