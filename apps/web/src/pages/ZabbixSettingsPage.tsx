import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, Navigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Link,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import { apiGet, apiPost, apiPut } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";
import { ZABBIX_ADMIN_ROLES, ZABBIX_BASE, zabbixErrorMessage } from "../api/zabbix";

interface Settings {
  configured: boolean;
  apiUrl: string | null;
  webUrl: string | null;
  enabled: boolean;
  requestTimeoutMs: number;
  tokenConfigured: boolean;
  tokenLast4: string | null;
  tokenUpdatedAt: string | null;
  updatedAt: string | null;
}

type CheckStatus = "PASS" | "WARN" | "FAIL" | "SKIP";
interface TestResult {
  ok: boolean;
  checkedAt: string;
  checks: { key: string; label: string; status: CheckStatus; detail: string }[];
}

const STATUS_ICON: Record<CheckStatus, JSX.Element> = {
  PASS: <CheckCircleOutlineIcon fontSize="small" color="success" />,
  WARN: <WarningAmberOutlinedIcon fontSize="small" color="warning" />,
  FAIL: <ErrorOutlineIcon fontSize="small" color="error" />,
  SKIP: <RemoveCircleOutlineIcon fontSize="small" color="disabled" />,
};

/**
 * Admin page for the Zabbix connection: the API URL (pre-seeded, editable),
 * an on/off switch, the request timeout and a write-only API token. "Test
 * connection" runs the server-side checklist, optionally against the values
 * typed here before they are saved.
 */
export function ZabbixSettingsPage() {
  const role = getCurrentUserRole();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("10000");
  const [enabled, setEnabled] = useState(true);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Settings>(`${ZABBIX_BASE}/settings`)
      .then((s) => {
        setSettings(s);
        setApiUrl(s.apiUrl ?? "");
        setTimeoutMs(String(s.requestTimeoutMs));
        setEnabled(s.enabled);
        setLoadError(null);
      })
      .catch((err) => setLoadError(zabbixErrorMessage(err).message));
  }, []);

  useEffect(load, [load]);

  if (!role || !ZABBIX_ADMIN_ROLES.includes(role)) {
    return <Navigate to="/zabbix" replace />;
  }

  const timeoutNumber = Number(timeoutMs);
  const timeoutInvalid =
    !Number.isInteger(timeoutNumber) || timeoutNumber < 1000 || timeoutNumber > 60000;
  const urlInvalid = !/^https?:\/\/.+/i.test(apiUrl.trim());

  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const body: Record<string, unknown> = {
        apiUrl: apiUrl.trim(),
        enabled,
        requestTimeoutMs: timeoutNumber,
        ...extra,
      };
      if (token.trim()) body.apiToken = token.trim();
      const s = await apiPut<Settings>(`${ZABBIX_BASE}/settings`, body);
      setSettings(s);
      setToken("");
      setSaveMessage({ ok: true, text: "Saved." });
    } catch (err) {
      setSaveMessage({ ok: false, text: zabbixErrorMessage(err).message });
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestError(null);
    try {
      const body: Record<string, string> = {};
      if (apiUrl.trim() && apiUrl.trim() !== settings?.apiUrl) body.apiUrl = apiUrl.trim();
      if (token.trim()) body.apiToken = token.trim();
      setTest(await apiPost<TestResult>(`${ZABBIX_BASE}/settings/test`, body));
    } catch (err) {
      setTestError(zabbixErrorMessage(err).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
        <Typography variant="h4">Zabbix settings</Typography>
        <Button variant="outlined" component={RouterLink} to="/zabbix">
          Open Zabbix view
        </Button>
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3, maxWidth: 760 }}>
        OpsDesk reads hosts, problems, latest values and graphs from this Zabbix server live.
        Nothing is copied into OpsDesk. Hosts need a <code>site</code> tag (for example SITE01) to
        be visible to site-scoped users, and a <code>ci</code> tag to link to their CMDB record.
      </Typography>

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load the settings: {loadError}
        </Alert>
      )}
      {!settings && !loadError && <CircularProgress size={28} />}

      {settings && (
        <Stack direction={{ xs: "column", lg: "row" }} spacing={3} alignItems="flex-start">
          <Paper sx={{ p: 3, flex: 1, width: "100%", maxWidth: 640 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Connection
            </Typography>
            <Stack spacing={2.5}>
              <TextField
                label="Zabbix API URL"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                error={urlInvalid}
                helperText={
                  urlInvalid
                    ? "Must start with http:// or https://"
                    : "The api_jsonrpc.php address, e.g. http://127.0.0.1/zabbix/api_jsonrpc.php"
                }
                fullWidth
              />
              <TextField
                label="API token"
                type="password"
                autoComplete="new-password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                helperText={
                  settings.tokenConfigured
                    ? `A token ending in …${settings.tokenLast4 ?? ""} is saved${
                        settings.tokenUpdatedAt
                          ? ` (since ${new Date(settings.tokenUpdatedAt).toLocaleString()})`
                          : ""
                      }. Leave empty to keep it.`
                    : "No token saved yet. Create one in Zabbix under Users → API tokens."
                }
                fullWidth
              />
              <TextField
                label="Request timeout (ms)"
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(e.target.value)}
                error={timeoutInvalid}
                helperText={
                  timeoutInvalid ? "Between 1000 and 60000" : "How long to wait for Zabbix"
                }
                sx={{ maxWidth: 240 }}
              />
              <FormControlLabel
                control={
                  <Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                }
                label={enabled ? "Integration on" : "Integration off"}
              />
              {saveMessage && (
                <Alert severity={saveMessage.ok ? "success" : "error"}>{saveMessage.text}</Alert>
              )}
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <Button
                  variant="contained"
                  disabled={saving || urlInvalid || timeoutInvalid}
                  onClick={() => save()}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button variant="outlined" disabled={testing || urlInvalid} onClick={runTest}>
                  {testing ? "Testing…" : "Test connection"}
                </Button>
                {settings.tokenConfigured && (
                  <Button
                    color="error"
                    disabled={saving}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Remove the saved Zabbix token? OpsDesk will stop reading Zabbix.",
                        )
                      ) {
                        void save({ clearToken: true });
                      }
                    }}
                  >
                    Remove token
                  </Button>
                )}
              </Stack>
              {settings.webUrl && (
                <Typography variant="body2" color="text.secondary">
                  Zabbix web:{" "}
                  <Link href={settings.webUrl} target="_blank" rel="noreferrer">
                    {settings.webUrl}
                  </Link>
                </Typography>
              )}
            </Stack>
          </Paper>

          <Paper sx={{ p: 3, flex: 1, width: "100%" }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
              <Typography variant="h6">Connection checklist</Typography>
              {test && (
                <Chip
                  size="small"
                  color={test.ok ? "success" : "error"}
                  label={test.ok ? "Healthy" : "Needs attention"}
                />
              )}
            </Stack>
            {testError && <Alert severity="error">{testError}</Alert>}
            {!test && !testError && (
              <Typography color="text.secondary">
                Run “Test connection” to check the URL, the token and what Zabbix can see.
              </Typography>
            )}
            {test && (
              <>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell width={90}>Result</TableCell>
                      <TableCell>Check</TableCell>
                      <TableCell>Detail</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {test.checks.map((c) => (
                      <TableRow key={c.key}>
                        <TableCell>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            {STATUS_ICON[c.status]}
                            <Typography variant="body2">{c.status}</Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>{c.label}</TableCell>
                        <TableCell sx={{ color: "text.secondary", wordBreak: "break-word" }}>
                          {c.detail}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Checked {new Date(test.checkedAt).toLocaleString()}
                  </Typography>
                </Box>
              </>
            )}
          </Paper>
        </Stack>
      )}
    </>
  );
}
