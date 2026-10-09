import { useCallback, useEffect, useMemo, useState } from "react";
import { Link as RouterLink, Navigate, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { LineChart } from "@mui/x-charts/LineChart";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import { apiGet } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";
import {
  AVAILABILITY_COLOR,
  REFRESH_MS,
  ZABBIX_ACK_ROLES,
  ZABBIX_BASE,
  ZABBIX_VIEW_ROLES,
  ZabbixHistory,
  ZabbixHost,
  ZabbixItem,
  ZabbixList,
  ZabbixProblem,
  formatAge,
  formatValue,
  severityColor,
  zabbixErrorMessage,
} from "../api/zabbix";
import { AcknowledgeDialog } from "./ZabbixPage";

const RANGES = [
  { key: "1h", label: "1 h", seconds: 3600 },
  { key: "6h", label: "6 h", seconds: 6 * 3600 },
  { key: "24h", label: "24 h", seconds: 24 * 3600 },
  { key: "7d", label: "7 d", seconds: 7 * 24 * 3600 },
  { key: "30d", label: "30 d", seconds: 30 * 24 * 3600 },
];

/** One Zabbix host: status, its problems, every latest value, and a graph per numeric item. */
export function ZabbixHostPage() {
  const { hostId = "" } = useParams();
  const role = getCurrentUserRole();
  const [host, setHost] = useState<(ZabbixHost & { webUrl: string }) | null>(null);
  const [items, setItems] = useState<ZabbixItem[] | null>(null);
  const [problems, setProblems] = useState<ZabbixProblem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ZabbixItem | null>(null);
  const [ackTarget, setAckTarget] = useState<ZabbixProblem | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, i, p] = await Promise.all([
        apiGet<ZabbixHost & { webUrl: string }>(`${ZABBIX_BASE}/hosts/${hostId}`),
        apiGet<ZabbixItem[]>(`${ZABBIX_BASE}/hosts/${hostId}/items`),
        apiGet<ZabbixList<ZabbixProblem>>(`${ZABBIX_BASE}/problems?hostId=${hostId}`),
      ]);
      setHost(h);
      setItems(i);
      setProblems(p.items);
      setError(null);
    } catch (err) {
      setError(zabbixErrorMessage(err).message);
    }
  }, [hostId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const visibleItems = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = items ?? [];
    return q ? list.filter((i) => `${i.name} ${i.key}`.toLowerCase().includes(q)) : list;
  }, [items, filter]);

  if (!role || !ZABBIX_VIEW_ROLES.includes(role)) {
    return <Navigate to="/" replace />;
  }
  const canAck = ZABBIX_ACK_ROLES.includes(role);

  return (
    <>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/zabbix?tab=hosts">
          Zabbix hosts
        </Link>
        <Typography color="text.primary">{host?.name ?? hostId}</Typography>
      </Breadcrumbs>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {!host && !error && <CircularProgress size={28} />}

      {host && (
        <>
          <Stack
            direction="row"
            alignItems="center"
            spacing={1.5}
            sx={{ mb: 2 }}
            flexWrap="wrap"
            useFlexGap
          >
            <Typography variant="h4">{host.name}</Typography>
            <Chip label={host.availability} color={AVAILABILITY_COLOR[host.availability]} />
            {host.inMaintenance && <Chip label="Maintenance" variant="outlined" />}
            {!host.enabled && <Chip label="Disabled" variant="outlined" />}
            <Box sx={{ flex: 1 }} />
            <Button
              size="small"
              href={`${host.webUrl}zabbix.php?action=host.dashboard.view&hostid=${host.hostId}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Zabbix
            </Button>
          </Stack>

          <Paper sx={{ p: 2, mb: 2 }}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={4}>
              <Fact label="Technical name" value={host.host} />
              <Fact label="Site" value={host.siteCode ?? "Not tagged"} />
              <Fact
                label="CMDB item"
                value={
                  host.ciId ? (
                    <Link component={RouterLink} to={`/cis/${host.ciId}`}>
                      {host.ciCode}
                    </Link>
                  ) : (
                    (host.ciCode ?? "Not tagged")
                  )
                }
              />
              <Fact label="Groups" value={host.groups.join(", ") || "—"} />
              <Fact
                label="Interfaces"
                value={
                  host.interfaces.length
                    ? host.interfaces.map((i) => (
                        <Box key={`${i.type}${i.address}${i.port}`}>
                          {i.type} {i.address}:{i.port} · {i.availability}
                          {i.error ? ` (${i.error})` : ""}
                        </Box>
                      ))
                    : "—"
                }
              />
            </Stack>
          </Paper>

          <Typography variant="h6" sx={{ mb: 1 }}>
            Active problems ({problems.length})
          </Typography>
          <Paper sx={{ mb: 3 }}>
            {problems.length === 0 ? (
              <Typography color="text.secondary" sx={{ p: 2 }}>
                No active problems on this host.
              </Typography>
            ) : (
              <Table size="small">
                <TableBody>
                  {problems.map((p) => (
                    <TableRow key={p.eventId}>
                      <TableCell width={120}>
                        <Chip
                          size="small"
                          label={p.severityLabel}
                          color={severityColor(p.severity)}
                        />
                      </TableCell>
                      <TableCell>{p.name}</TableCell>
                      <TableCell width={110}>{formatAge(p.ageSeconds)}</TableCell>
                      <TableCell width={130}>
                        {p.acknowledged ? "Acknowledged" : "Not acknowledged"}
                      </TableCell>
                      {canAck && (
                        <TableCell align="right" width={140}>
                          <Button size="small" onClick={() => setAckTarget(p)}>
                            {p.acknowledged ? "Add note" : "Acknowledge"}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paper>

          {selected && <ItemGraph item={selected} onClose={() => setSelected(null)} />}

          <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
            <Typography variant="h6">Latest values ({items?.length ?? 0})</Typography>
            <TextField
              size="small"
              placeholder="Filter by name or key"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              sx={{ minWidth: 260 }}
            />
          </Stack>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell>Latest value</TableCell>
                  <TableCell>Change</TableCell>
                  <TableCell>Last check</TableCell>
                  <TableCell align="right">Graph</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleItems.map((i) => (
                  <TableRow key={i.itemId} hover selected={selected?.itemId === i.itemId}>
                    <TableCell>
                      {i.name}
                      <Typography variant="caption" color="text.secondary" display="block">
                        {i.key}
                      </Typography>
                      {!i.supported && i.error && (
                        <Typography variant="caption" color="error" display="block">
                          {i.error}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell
                      sx={{
                        fontVariantNumeric: "tabular-nums",
                        maxWidth: 320,
                        wordBreak: "break-word",
                      }}
                    >
                      {i.numeric ? formatValue(i.lastValue, i.units) : (i.lastValue ?? "—")}
                    </TableCell>
                    <TableCell sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {i.numeric && i.lastValue !== null && i.previousValue !== null
                        ? formatDelta(Number(i.lastValue) - Number(i.previousValue), i.units)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {i.lastSeenAt ? new Date(i.lastSeenAt).toLocaleTimeString() : "never"}
                    </TableCell>
                    <TableCell align="right">
                      {i.numeric && (
                        <Button
                          size="small"
                          startIcon={<ShowChartIcon />}
                          onClick={() => {
                            setSelected(i);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          Graph
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {items && visibleItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary">
                        {items.length === 0
                          ? "This host has no enabled items."
                          : "No items match this filter."}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
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

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" component="div">
        {value}
      </Typography>
    </Box>
  );
}

function formatDelta(delta: number, units: string): string {
  if (!Number.isFinite(delta) || delta === 0) return "0";
  return `${delta > 0 ? "+" : "−"}${formatValue(Math.abs(delta), units)}`;
}

/** Single-series line for one item. Live from Zabbix; hourly averages beyond 3 days. */
function ItemGraph({ item, onClose }: { item: ZabbixItem; onClose: () => void }) {
  const [range, setRange] = useState("6h");
  const [data, setData] = useState<ZabbixHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const seconds = RANGES.find((r) => r.key === range)?.seconds ?? 6 * 3600;
    const to = Math.floor(Date.now() / 1000);
    setLoading(true);
    try {
      setData(
        await apiGet<ZabbixHistory>(
          `${ZABBIX_BASE}/items/${item.itemId}/history?from=${to - seconds}&to=${to}`,
        ),
      );
      setError(null);
    } catch (err) {
      setError(zabbixErrorMessage(err).message);
    } finally {
      setLoading(false);
    }
  }, [item.itemId, range]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const longRange = (RANGES.find((r) => r.key === range)?.seconds ?? 0) > 24 * 3600;
  const points = data?.points ?? [];

  return (
    <Paper sx={{ p: 2, mb: 3 }}>
      <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap" useFlexGap>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="h6">{item.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {item.key}
            {data?.source === "trends" ? " · hourly averages" : ""}
            {item.units ? ` · ${item.units}` : ""}
          </Typography>
        </Box>
        {loading && <CircularProgress size={18} />}
        <ToggleButtonGroup
          size="small"
          exclusive
          value={range}
          onChange={(_, v: string | null) => v && setRange(v)}
        >
          {RANGES.map((r) => (
            <ToggleButton key={r.key} value={r.key}>
              {r.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Button size="small" onClick={onClose}>
          Close
        </Button>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
      {!error && data && points.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 6, textAlign: "center" }}>
          No data in this time range.
        </Typography>
      )}
      {!error && points.length > 0 && (
        <LineChart
          height={300}
          margin={{ left: 70, right: 20, top: 20, bottom: 30 }}
          xAxis={[
            {
              scaleType: "time",
              data: points.map((p) => new Date(p.t)),
              valueFormatter: (d: Date) =>
                longRange
                  ? d.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                    })
                  : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
            },
          ]}
          yAxis={[{ valueFormatter: (v: number) => formatValue(v, item.units) }]}
          series={[
            {
              data: points.map((p) => p.v),
              showMark: false,
              color: "#1976d2",
              valueFormatter: (v) => formatValue(v ?? null, item.units),
            },
          ]}
          grid={{ horizontal: true }}
          slotProps={{ legend: { hidden: true } }}
          sx={{ "& .MuiLineElement-root": { strokeWidth: 2 } }}
        />
      )}
    </Paper>
  );
}
