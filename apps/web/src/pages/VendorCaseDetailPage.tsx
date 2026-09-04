import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert,
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
  TextField,
  Typography,
} from "@mui/material";
import { apiGet, apiPatch, apiPost } from "../api/client";

const DISPATCH_STATUSES = [
  "REQUESTED",
  "APPROVED",
  "SHIPPED",
  "DELIVERED",
  "INSTALLED",
  "RETURNED",
];
const WARRANTY_STATUSES = ["ACTIVE", "EXPIRED", "UNKNOWN"];

interface VendorCaseUpdate {
  id: string;
  note: string;
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
  replacementPart: string | null;
  vendorEta: string | null;
  openedAt: string;
  acknowledgedAt: string | null;
  closedAt: string | null;
  outcome: string | null;
  updates: VendorCaseUpdate[];
}

/**
 * Vendor case workspace (spec §10.13): header, the dispatch lifecycle advance,
 * part / warranty / ETA edits, acknowledge, close-with-outcome, an append-only
 * note, and the case history. Backend validates every transition — the UI just
 * submits and refetches.
 */
export function VendorCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [vc, setVc] = useState<VendorCase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!id) return;
    setError(null);
    apiGet<VendorCase>(`/vendor-cases/${id}`)
      .then(setVc)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const patch = async (body: Record<string, unknown>, reset?: () => void) => {
    if (!id) return;
    setActionError(null);
    try {
      await apiPatch(`/vendor-cases/${id}`, body);
      reset?.();
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const [toDispatch, setToDispatch] = useState("");
  const [part, setPart] = useState("");
  const [warranty, setWarranty] = useState("");
  const [eta, setEta] = useState("");
  const [closeOutcome, setCloseOutcome] = useState("");
  const [note, setNote] = useState("");

  const addNote = async () => {
    if (!id || !note) return;
    setActionError(null);
    try {
      await apiPost(`/vendor-cases/${id}/updates`, { note });
      setNote("");
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return (
      <Alert severity="error">
        Could not load vendor case {id}: {error}
      </Alert>
    );
  }
  if (!vc) {
    return <Typography color="text.secondary">Loading...</Typography>;
  }

  const closed = Boolean(vc.closedAt);

  return (
    <Box>
      <Link component={RouterLink} to="/vendors" sx={{ display: "inline-block", mb: 2 }}>
        ← All vendors
      </Link>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h5">{vc.vendorCaseNo}</Typography>
            <Chip label={vc.dispatchStatus ?? "no dispatch"} />
            <Chip label={vc.warrantyStatus} />
            {vc.rmaRequired && <Chip label="RMA" color="warning" />}
            {closed && <Chip label="closed" color="default" />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Vendor: {vc.vendorId} · CI: {vc.ciId ?? "—"} · Incident: {vc.linkedIncidentId ?? "—"}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Part: {vc.replacementPart ?? "—"} · Vendor ETA:{" "}
            {vc.vendorEta ? new Date(vc.vendorEta).toLocaleString() : "—"}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Opened {new Date(vc.openedAt).toLocaleString()}
            {vc.acknowledgedAt && ` · acknowledged ${new Date(vc.acknowledgedAt).toLocaleString()}`}
            {vc.closedAt && ` · closed ${new Date(vc.closedAt).toLocaleString()}`}
          </Typography>
          {vc.outcome && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Outcome: {vc.outcome}
            </Typography>
          )}
        </CardContent>
      </Card>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Actions
            </Typography>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1}>
                <TextField
                  select
                  size="small"
                  label="Advance dispatch to"
                  value={toDispatch}
                  onChange={(e) => setToDispatch(e.target.value)}
                  sx={{ flex: 1 }}
                  disabled={closed}
                >
                  {DISPATCH_STATUSES.map((s) => (
                    <MenuItem key={s} value={s}>
                      {s}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  variant="contained"
                  disabled={!toDispatch || closed}
                  onClick={() => patch({ dispatchStatus: toDispatch }, () => setToDispatch(""))}
                >
                  Apply
                </Button>
              </Stack>

              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  label="Replacement part"
                  value={part}
                  onChange={(e) => setPart(e.target.value)}
                  sx={{ flex: 1 }}
                  disabled={closed}
                />
                <Button
                  disabled={!part || closed}
                  onClick={() => patch({ replacementPart: part }, () => setPart(""))}
                >
                  Set
                </Button>
              </Stack>

              <Stack direction="row" spacing={1}>
                <TextField
                  select
                  size="small"
                  label="Warranty status"
                  value={warranty}
                  onChange={(e) => setWarranty(e.target.value)}
                  sx={{ flex: 1 }}
                  disabled={closed}
                >
                  {WARRANTY_STATUSES.map((s) => (
                    <MenuItem key={s} value={s}>
                      {s}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  disabled={!warranty || closed}
                  onClick={() => patch({ warrantyStatus: warranty }, () => setWarranty(""))}
                >
                  Set
                </Button>
              </Stack>

              <Stack direction="row" spacing={1}>
                <TextField
                  type="datetime-local"
                  size="small"
                  label="Vendor ETA"
                  InputLabelProps={{ shrink: true }}
                  value={eta}
                  onChange={(e) => setEta(e.target.value)}
                  sx={{ flex: 1 }}
                  disabled={closed}
                />
                <Button
                  disabled={!eta || closed}
                  onClick={() =>
                    patch({ vendorEta: new Date(eta).toISOString() }, () => setEta(""))
                  }
                >
                  Set
                </Button>
              </Stack>

              <Button
                variant="outlined"
                disabled={closed || Boolean(vc.acknowledgedAt)}
                onClick={() => patch({ acknowledged: true })}
              >
                {vc.acknowledgedAt ? "Acknowledged" : "Mark vendor-acknowledged"}
              </Button>

              <Divider />
              <TextField
                size="small"
                label="Close with outcome"
                multiline
                value={closeOutcome}
                onChange={(e) => setCloseOutcome(e.target.value)}
                disabled={closed}
              />
              <Button
                variant="contained"
                color="error"
                disabled={!closeOutcome || closed}
                onClick={() => patch({ closeOutcome }, () => setCloseOutcome(""))}
              >
                Close case
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              History
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {vc.updates.map((u) => (
                <Box key={u.id}>
                  <Typography variant="body2">{u.note}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(u.createdAt).toLocaleString()}
                  </Typography>
                  <Divider sx={{ mt: 1 }} />
                </Box>
              ))}
              {vc.updates.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No notes yet.
                </Typography>
              )}
            </Stack>
            <TextField
              fullWidth
              size="small"
              multiline
              label="Add a note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              sx={{ mb: 1 }}
            />
            <Button variant="contained" disabled={!note} onClick={addNote}>
              Add note
            </Button>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
