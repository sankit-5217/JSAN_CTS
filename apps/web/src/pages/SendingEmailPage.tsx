import { useCallback, useEffect, useState } from "react";
import { Navigate, Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { apiDelete, apiGet, apiPost, getStoredToken, ApiError } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";

interface Status {
  account: { email: string; provider: string; updatedAt: string } | null;
  providers: { provider: string; configured: boolean }[];
}
const labels: Record<string, string> = {
  google: "Gmail / Google Workspace",
  microsoft: "Outlook / Microsoft 365",
  yahoo: "Yahoo",
  icloud: "iCloud",
  zoho: "Zoho",
};
export function SendingEmailPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState("yahoo");
  const [password, setPassword] = useState("");
  const [query] = useSearchParams();
  const token = getStoredToken();
  const failure = (err: unknown) => {
    const message =
      err instanceof ApiError ? (err.body as { message?: unknown } | null)?.message : undefined;
    setError(
      typeof message === "string"
        ? message
        : "Could not update your email connection. Please try again.",
    );
  };
  const load = useCallback(async () => {
    try {
      setStatus(await apiGet<Status>("/sending-mail"));
    } catch (err) {
      failure(err);
    }
  }, []);
  useEffect(() => {
    if (token) void load();
  }, [load, token]);
  if (!token) return <Navigate to="/login" replace />;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      failure(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box sx={{ maxWidth: 700, mx: "auto", p: { xs: 2, sm: 4 } }}>
      <Button
        component={RouterLink}
        to={getCurrentUserRole() === "CLIENT_MANAGER_VIEWER" ? "/client/home" : "/"}
      >
        Back to OpsDesk
      </Button>
      <Card sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            Sending email account
          </Typography>
          <Typography sx={{ mb: 2 }}>
            Connect the same email address you use for OpsDesk. When you raise a ticket or add a
            comment, notifications will be sent as JSAN OpsDesk using your email address.
          </Typography>
          {query.get("result") === "connected" && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Your mailbox is connected.
            </Alert>
          )}
          {query.get("result") === "failed" && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Email authorization failed. Choose your OpsDesk email address and grant permission to
              send email, then try again.
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {!status && !error && <CircularProgress aria-label="Loading email account" />}
          {status && (
            <Stack spacing={2}>
              {status.account ? (
                <Alert severity="success">
                  Connected: {status.account.email} (
                  {labels[status.account.provider] ?? status.account.provider})
                </Alert>
              ) : (
                <Alert severity="info">
                  No mailbox connected. Your ticket updates will still be saved, but personal email
                  notifications cannot be delivered until you connect.
                </Alert>
              )}
              {status.providers.map((p) => (
                <Box key={p.provider}>
                  <Button
                    variant="outlined"
                    disabled={busy || !p.configured}
                    onClick={() =>
                      void run(async () => {
                        const { url } = await apiPost<{ url: string }>(
                          `/sending-mail/connect/${p.provider}`,
                        );
                        window.location.assign(url);
                      })
                    }
                  >
                    Connect {labels[p.provider]}
                  </Button>
                  {!p.configured && (
                    <Typography variant="caption" display="block">
                      An administrator needs to enable this provider first.
                    </Typography>
                  )}
                </Box>
              ))}
              <Typography variant="subtitle1">Other supported mailboxes</Typography>
              <Typography variant="body2">
                Use an app password created in your email provider's security settings. It is
                encrypted and never displayed again. Your email address is taken from your OpsDesk
                account.
              </Typography>
              <TextField
                select
                label="Email provider"
                value={provider}
                disabled={busy}
                onChange={(e) => setProvider(e.target.value)}
              >
                {["yahoo", "icloud", "zoho"].map((p) => (
                  <MenuItem key={p} value={p}>
                    {labels[p]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="App password"
                type="password"
                autoComplete="new-password"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button
                variant="contained"
                disabled={busy || !password.trim()}
                onClick={() =>
                  void run(async () => {
                    try {
                      await apiPost("/sending-mail/smtp", { provider, password });
                      await load();
                    } finally {
                      setPassword("");
                    }
                  })
                }
              >
                Verify and connect
              </Button>
              {status.account && (
                <Button
                  color="error"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await apiDelete("/sending-mail");
                      await load();
                    })
                  }
                >
                  Disconnect mailbox
                </Button>
              )}
              <Typography variant="caption">
                Automatic system notifications use the OpsDesk service mailbox. Disconnecting
                removes the credentials saved in OpsDesk; you can also revoke access in your
                provider's account settings.
              </Typography>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
