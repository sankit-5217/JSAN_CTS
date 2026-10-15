import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { apiGet, apiPost } from "../api/client";
import { zabbixErrorMessage } from "../api/zabbix";
import { formatDateTime } from "../time/clock";

interface Enrollment {
  id: string;
  label: string | null;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  expiresAt: string;
  enrolledCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

interface CreatedEnrollment extends Enrollment {
  code: string;
  commands: { linux: string; windowsPowerShell: string; windowsCurl: string };
}

const STATUS_COLOR: Record<Enrollment["status"], "success" | "default" | "error"> = {
  ACTIVE: "success",
  EXPIRED: "default",
  REVOKED: "error",
};

function CommandBox({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" alignItems="flex-start" spacing={1}>
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 1,
            flex: 1,
            bgcolor: "grey.100",
            borderRadius: 1,
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {command}
        </Box>
        <Tooltip title={copied ? "Copied" : "Copy"}>
          <IconButton
            size="small"
            aria-label={`Copy ${label}`}
            onClick={() => {
              void navigator.clipboard.writeText(command).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}

/**
 * Site page panel (Zabbix admins only): create a one-line installer link for
 * this site, copy the Linux / Windows commands to send to the client, and see
 * or revoke earlier links. The code is shown once — only its hash is stored.
 */
export function AgentEnrollmentCard({ siteId, siteCode }: { siteId: string; siteCode: string }) {
  const [rows, setRows] = useState<Enrollment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedEnrollment | null>(null);

  const load = useCallback(() => {
    apiGet<Enrollment[]>(`/monitoring/agent-enrollments?siteId=${siteId}`)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((err) => setError(zabbixErrorMessage(err).message));
  }, [siteId]);

  useEffect(load, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<CreatedEnrollment>("/monitoring/agent-enrollments", {
        siteId,
        label: label.trim() || undefined,
        expiresInDays: days,
      });
      setCreated(res);
      setLabel("");
      load();
    } catch (err) {
      setError(zabbixErrorMessage(err).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setError(null);
    try {
      await apiPost(`/monitoring/agent-enrollments/${id}/revoke`, {});
      if (created?.id === id) setCreated(null);
      load();
    } catch (err) {
      setError(zabbixErrorMessage(err).message);
    }
  };

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Typography variant="h6">Monitoring agents</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 820 }}>
        Create a link and send the command to {siteCode}&apos;s IT team. They run it on each server
        they want monitored (any number of servers, until the link expires). The agent connects out
        to JSAN over an encrypted channel — no inbound port or VPN is needed. On Linux it also
        updates the OS packages first (add <code>-s -- --skip-upgrade</code> after <code>bash</code>{" "}
        to skip that).
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          inputProps={{ maxLength: 120 }}
          sx={{ minWidth: 260 }}
        />
        <TextField
          size="small"
          select
          label="Valid for"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          sx={{ width: 140 }}
        >
          {[1, 3, 7, 14, 30].map((d) => (
            <MenuItem key={d} value={d}>
              {d} day{d > 1 ? "s" : ""}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" onClick={create} disabled={busy}>
          {busy ? "Creating…" : "Create install link"}
        </Button>
      </Stack>

      {created && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setCreated(null)}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Link created, valid until {formatDateTime(created.expiresAt)}. Copy the commands now —
            they are not shown again.
          </Typography>
          <Stack spacing={1.5}>
            <CommandBox label="Linux (as root / with sudo)" command={created.commands.linux} />
            <CommandBox
              label="Windows (PowerShell, Run as administrator)"
              command={created.commands.windowsPowerShell}
            />
            <CommandBox
              label="Windows (curl.exe alternative)"
              command={created.commands.windowsCurl}
            />
          </Stack>
        </Alert>
      )}

      {rows === null && !error && <CircularProgress size={22} />}
      {rows && rows.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No install links for this site yet.
        </Typography>
      )}
      {rows && rows.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Label</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Expires</TableCell>
              <TableCell align="right">Machines enrolled</TableCell>
              <TableCell>Last used</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.label ?? "—"}</TableCell>
                <TableCell>
                  <Chip size="small" label={r.status} color={STATUS_COLOR[r.status]} />
                </TableCell>
                <TableCell>{formatDateTime(r.expiresAt)}</TableCell>
                <TableCell align="right">{r.enrolledCount}</TableCell>
                <TableCell>{r.lastUsedAt ? formatDateTime(r.lastUsedAt) : "—"}</TableCell>
                <TableCell align="right">
                  {r.status === "ACTIVE" && (
                    <Button size="small" color="error" onClick={() => revoke(r.id)}>
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}
