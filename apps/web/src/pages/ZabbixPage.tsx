import { useCallback, useEffect, useMemo, useState } from "react";
import { Link as RouterLink, Navigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { apiGet, apiPost } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";
import {
  AVAILABILITY_COLOR,
  REFRESH_MS,
  ZABBIX_ACK_ROLES,
  ZABBIX_ADMIN_ROLES,
  ZABBIX_BASE,
  ZABBIX_VIEW_ROLES,
  ZabbixHost,
  ZabbixList,
  ZabbixProblem,
  formatAge,
  severityColor,
  zabbixErrorMessage,
} from "../api/zabbix";

const SEVERITY_OPTIONS = [
  { value: 0, label: "All severities" },
  { value: 2, label: "Warning and above" },
  { value: 3, label: "Average and above" },
  { value: 4, label: "High and above" },
  { value: 5, label: "Disaster only" },
];

/**
 * Live Zabbix inside OpsDesk: active problems (acknowledge in place) and the
 * monitored hosts in the user's sites. Refreshes every 30 s; nothing is stored.
 */
export function ZabbixPage() {
  const role = getCurrentUserRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "hosts" ? "hosts" : "problems";
  const minSeverity = Number(searchParams.get("minSeverity") ?? "0");

  const [problems, setProblems] = useState<ZabbixList<ZabbixProblem> | null>(null);
  const [hosts, setHosts] = useState<ZabbixList<ZabbixHost> | null>(null);
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [hostFilter, setHostFilter] = useState("");
  const [ackTarget, setAckTarget] = useState<ZabbixProblem | null>(null);

  const canAck = role !== null && ZABBIX_ACK_ROLES.includes(role);
  const isAdmin = role !== null && ZABBIX_ADMIN_ROLES.includes(role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, h] = await Promise.all([
        apiGet<ZabbixList<ZabbixProblem>>(`${ZABBIX_BASE}/problems?minSeverity=${minSeverity}`),
        apiGet<ZabbixList<ZabbixHost>>(`${ZABBIX_BASE}/hosts`),
      ]);
      setProblems(p);
      setHosts(h);
      setError(null);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(zabbixErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [minSeverity]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const summary = useMemo(() => {
    const list = hosts?.items ?? [];
    return {
      up: list.filter((h) => h.availability === "UP").length,
      down: list.filter((h) => h.availability === "DOWN").length,
      unknown: list.filter((h) => h.availability === "UNKNOWN").length,
      problems: problems?.items.length ?? 0,
      unacked: problems?.items.filter((p) => !p.acknowledged).length ?? 0,
      highPlus: problems?.items.filter((p) => p.severity >= 4).length ?? 0,
    };
  }, [hosts, problems]);

  const filteredHosts = useMemo(() => {
    const q = hostFilter.trim().toLowerCase();
    const list = hosts?.items ?? [];
    if (!q) return list;
    return list.filter((h) =>
      [h.name, h.host, h.siteCode, h.ciCode, ...h.groups, ...h.interfaces.map((i) => i.address)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [hosts, hostFilter]);

  if (!role || !ZABBIX_VIEW_ROLES.includes(role)) {
    return <Navigate to="/" replace />;
  }

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const webUrl = problems?.webUrl ?? hosts?.webUrl;

  return (
    <>
      <Stack
        direction="row"
        alignItems="center"
        spacing={2}
        sx={{ mb: 2 }}
        flexWrap="wrap"
        useFlexGap
      >
        <Typography variant="h4">Zabbix</Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
          onClick={() => void load()}
          disabled={loading}
        >
          Refresh
        </Button>
        {updatedAt && (
          <Typography variant="body2" color="text.secondary">
            Updated {updatedAt.toLocaleTimeString()} · refreshes every 30 s
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {webUrl && (
          <Button
            size="small"
            endIcon={<OpenInNewIcon />}
            href={webUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Zabbix
          </Button>
        )}
        {isAdmin && (
          <Button size="small" component={RouterLink} to="/zabbix/settings">
            Settings
          </Button>
        )}
      </Stack>

      {error && (
        <Alert
          severity={
            error.code?.startsWith("ZABBIX_NOT") || error.code === "ZABBIX_DISABLED"
              ? "info"
              : "error"
          }
          sx={{ mb: 2 }}
        >
          {error.message}
          {isAdmin &&
            (error.code === "ZABBIX_NOT_CONFIGURED" || error.code === "ZABBIX_DISABLED") && (
              <>
                {" "}
                <Link component={RouterLink} to="/zabbix/settings">
                  Open Zabbix settings
                </Link>
              </>
            )}
        </Alert>
      )}

      {!problems && !hosts && !error && <CircularProgress size={28} />}

      {(problems || hosts) && (
        <>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
            <SummaryTile label="Hosts up" value={summary.up} />
            <SummaryTile
              label="Hosts down"
              value={summary.down}
              tone={summary.down > 0 ? "error" : undefined}
            />
            <SummaryTile label="Hosts unknown" value={summary.unknown} />
            <SummaryTile label="Active problems" value={summary.problems} />
            <SummaryTile
              label="Not acknowledged"
              value={summary.unacked}
              tone={summary.unacked > 0 ? "warning" : undefined}
            />
            <SummaryTile
              label="High or Disaster"
              value={summary.highPlus}
              tone={summary.highPlus > 0 ? "error" : undefined}
            />
          </Stack>

          <Tabs
            value={tab}
            onChange={(_, v: string) => setParam("tab", v === "problems" ? null : v)}
            sx={{ mb: 2 }}
          >
            <Tab value="problems" label={`Problems (${summary.problems})`} />
            <Tab value="hosts" label={`Hosts (${hosts?.items.length ?? 0})`} />
          </Tabs>

          {tab === "problems" && (
            <>
              <TextField
                select
                size="small"
                label="Severity"
                value={minSeverity}
                onChange={(e) =>
                  setParam("minSeverity", e.target.value === "0" ? null : e.target.value)
                }
                sx={{ minWidth: 220, mb: 2 }}
              >
                {SEVERITY_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Severity</TableCell>
                      <TableCell>Problem</TableCell>
                      <TableCell>Host</TableCell>
                      <TableCell>Site</TableCell>
                      <TableCell>Age</TableCell>
                      <TableCell>Acknowledged</TableCell>
                      {canAck && <TableCell align="right">Action</TableCell>}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(problems?.items ?? []).map((p) => (
                      <TableRow key={p.eventId} hover>
                        <TableCell>
                          <Chip
                            size="small"
                            label={p.severityLabel}
                            color={severityColor(p.severity)}
                          />
                        </TableCell>
                        <TableCell>
                          {p.name}
                          {p.operationalData && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              {p.operationalData}
                            </Typography>
                          )}
                          {p.acknowledges[0] && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              Last note: {p.acknowledges[0].message}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          {p.host ? (
                            <Link component={RouterLink} to={`/zabbix/hosts/${p.host.hostId}`}>
                              {p.host.name}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>{p.host?.siteCode ?? "—"}</TableCell>
                        <TableCell title={new Date(p.startedAt).toLocaleString()}>
                          {formatAge(p.ageSeconds)}
                        </TableCell>
                        <TableCell>{p.acknowledged ? "Yes" : "No"}</TableCell>
                        {canAck && (
                          <TableCell align="right">
                            <Button size="small" onClick={() => setAckTarget(p)}>
                              {p.acknowledged ? "Add note" : "Acknowledge"}
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {problems && problems.items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={canAck ? 7 : 6}>
                          <Typography variant="body2" color="text.secondary">
                            No active problems{minSeverity > 0 ? " at this severity" : ""} in your
                            sites.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}

          {tab === "hosts" && (
            <>
              <TextField
                size="small"
                label="Filter hosts"
                placeholder="Name, site, CI, group or IP"
                value={hostFilter}
                onChange={(e) => setHostFilter(e.target.value)}
                sx={{ minWidth: 300, mb: 2 }}
              />
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Host</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Site</TableCell>
                      <TableCell>CMDB</TableCell>
                      <TableCell>Interfaces</TableCell>
                      <TableCell>Groups</TableCell>
                      <TableCell>Problems</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredHosts.map((h) => (
                      <TableRow key={h.hostId} hover>
                        <TableCell>
                          <Link component={RouterLink} to={`/zabbix/hosts/${h.hostId}`}>
                            {h.name}
                          </Link>
                          {h.name !== h.host && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              {h.host}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5}>
                            <Chip
                              size="small"
                              label={h.availability}
                              color={AVAILABILITY_COLOR[h.availability]}
                            />
                            {!h.enabled && (
                              <Chip size="small" label="Disabled" variant="outlined" />
                            )}
                            {h.inMaintenance && (
                              <Chip size="small" label="Maintenance" variant="outlined" />
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>{h.siteCode ?? "—"}</TableCell>
                        <TableCell>
                          {h.ciId ? (
                            <Link component={RouterLink} to={`/cis/${h.ciId}`}>
                              {h.ciCode}
                            </Link>
                          ) : (
                            (h.ciCode ?? "—")
                          )}
                        </TableCell>
                        <TableCell>
                          {h.interfaces.map((i) => `${i.type} ${i.address}:${i.port}`).join(", ") ||
                            "—"}
                        </TableCell>
                        <TableCell>{h.groups.join(", ") || "—"}</TableCell>
                        <TableCell>
                          {h.problemCount ? (
                            <Chip
                              size="small"
                              label={h.problemCount}
                              color={severityColor(h.maxSeverity ?? 0)}
                            />
                          ) : (
                            "0"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {hosts && filteredHosts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <Typography variant="body2" color="text.secondary">
                            {hosts.items.length === 0
                              ? "No Zabbix hosts are tagged with your sites yet."
                              : "No hosts match this filter."}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </>
      )}

      <AcknowledgeDialog
        problem={ackTarget}
        onClose={() => setAckTarget(null)}
        onDone={() => {
          setAckTarget(null);
          void load();
        }}
      />
    </>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "error" | "warning";
}) {
  return (
    <Paper sx={{ px: 2, py: 1.5, minWidth: 140 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" color={tone ? `${tone}.main` : "text.primary"}>
        {value}
      </Typography>
    </Paper>
  );
}

export function AcknowledgeDialog({
  problem,
  onClose,
  onDone,
}: {
  problem: ZabbixProblem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMessage("");
    setError(null);
  }, [problem]);

  const submit = async () => {
    if (!problem) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`${ZABBIX_BASE}/problems/${problem.eventId}/acknowledge`, {
        message: message.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(zabbixErrorMessage(err).message);
    } finally {
      setBusy(false);
    }
  };

  const needsMessage = Boolean(problem?.acknowledged) && !message.trim();

  return (
    <Dialog open={Boolean(problem)} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{problem?.acknowledged ? "Add a note" : "Acknowledge problem"}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>
          {problem?.name}
          {problem?.host ? ` on ${problem.host.name}` : ""}
        </Typography>
        <TextField
          label={problem?.acknowledged ? "Note (required)" : "Note (optional)"}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          multiline
          minRows={2}
          fullWidth
          slotProps={{ htmlInput: { maxLength: 1000 } }}
          helperText="Saved in Zabbix with your OpsDesk email, and in the OpsDesk audit trail."
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || needsMessage}>
          {busy ? "Saving…" : problem?.acknowledged ? "Add note" : "Acknowledge"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
