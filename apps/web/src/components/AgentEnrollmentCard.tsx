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
  status: "ACTIVE" | "FULL" | "EXPIRED" | "REVOKED";
  expiresAt: string;
  enrolledCount: number;
  maxMachines: number;
  changeReference: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface CreatedEnrollment extends Enrollment {
  code: string;
  commands: { linux: string; windowsPowerShell: string; windowsCurl: string };
  warnings: string[];
}

/** Same bound as the API (MAX_MACHINES_PER_LINK). */
const MAX_MACHINES_PER_LINK = 500;

const STATUS_COLOR: Record<Enrollment["status"], "success" | "default" | "error"> = {
  ACTIVE: "success",
  FULL: "default",
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
  const [days, setDays] = useState(3);
  const [maxMachines, setMaxMachines] = useState("");
  const [changeReference, setChangeReference] = useState("");
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

  const machines = Number(maxMachines);
  const machinesValid =
    Number.isInteger(machines) && machines >= 1 && machines <= MAX_MACHINES_PER_LINK;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<CreatedEnrollment>("/monitoring/agent-enrollments", {
        siteId,
        label: label.trim() || undefined,
        expiresInDays: days,
        maxMachines: machines,
        changeReference: changeReference.trim() || undefined,
      });
      setCreated(res);
      setLabel("");
      setMaxMachines("");
      setChangeReference("");
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
        they want monitored, up to the link&apos;s machine limit and until it expires. The agent
        connects out to JSAN over an encrypted channel — no inbound port or VPN is needed. OS
        packages are left alone (on Linux, <code>-s -- --upgrade</code> after <code>bash</code> also
        updates them). Each machine is matched to its asset by serial number; one that isn&apos;t in
        the asset register is added as PLANNED for review.
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
          required
          type="number"
          label="Max machines"
          value={maxMachines}
          onChange={(e) => setMaxMachines(e.target.value)}
          error={maxMachines !== "" && !machinesValid}
          helperText={maxMachines !== "" && !machinesValid ? `1 to ${MAX_MACHINES_PER_LINK}` : " "}
          inputProps={{ min: 1, max: MAX_MACHINES_PER_LINK, step: 1 }}
          sx={{ width: 140 }}
        />
        <TextField
          size="small"
          label="Client change ref (optional)"
          value={changeReference}
          onChange={(e) => setChangeReference(e.target.value)}
          inputProps={{ maxLength: 60 }}
          sx={{ minWidth: 200 }}
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
        <Button
          variant="contained"
          onClick={create}
          disabled={busy || !machinesValid}
          sx={{ alignSelf: "flex-start" }}
        >
          {busy ? "Creating…" : "Create install link"}
        </Button>
      </Stack>

      {created?.warnings.map((w) => (
        <Alert key={w} severity="warning" sx={{ mb: 2 }}>
          {w}
        </Alert>
      ))}
      {created && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setCreated(null)}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Link created for up to {created.maxMachines} machine
            {created.maxMachines > 1 ? "s" : ""}, valid until {formatDateTime(created.expiresAt)}.
            Copy the commands now — they are not shown again.
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
              <TableCell>Change ref</TableCell>
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
                <TableCell>{r.changeReference ?? "—"}</TableCell>
                <TableCell>
                  <Chip size="small" label={r.status} color={STATUS_COLOR[r.status]} />
                </TableCell>
                <TableCell>{formatDateTime(r.expiresAt)}</TableCell>
                <TableCell align="right">
                  {r.enrolledCount} / {r.maxMachines}
                </TableCell>
                <TableCell>{r.lastUsedAt ? formatDateTime(r.lastUsedAt) : "—"}</TableCell>
                <TableCell align="right">
                  {(r.status === "ACTIVE" || r.status === "FULL") && (
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
