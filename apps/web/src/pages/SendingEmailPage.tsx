import { useCallback, useEffect, useState } from "react";
import { Navigate, Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { apiDelete, apiGet, apiPost, getStoredToken, ApiError } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";

interface Status {
  senderEmail: string;
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
  const [query] = useSearchParams();
  const token = getStoredToken();
  const role = getCurrentUserRole();
  const failure = (err: unknown) => {
    const message =
      err instanceof ApiError ? (err.body as { message?: unknown } | null)?.message : undefined;
    setError(
      typeof message === "string"
        ? message
        : "Could not update the shared email connection. Please try again.",
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
    if (token && role === "SUPER_ADMIN") void load();
  }, [load, token, role]);
  if (!token) return <Navigate to="/login" replace />;
  if (role !== "SUPER_ADMIN")
    return <Navigate to={role === "CLIENT_MANAGER_VIEWER" ? "/client/home" : "/"} replace />;
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
            Shared sending email
          </Typography>
          <Typography sx={{ mb: 2 }}>
            Authorize the shared mailbox once. Notifications for all clients and team members are
            sent as JSAN OpsDesk. Ticket and comment emails show the person who made the update, and
            replies go to that person. Users do not need to connect their own email.
          </Typography>
          {query.get("result") === "connected" && (
            <Alert severity="success" sx={{ mb: 2 }}>
              The shared mailbox is connected for all users.
            </Alert>
          )}
          {query.get("result") === "failed" && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Email authorization failed. Sign in to the configured shared mailbox and grant
              permission to send email, then try again.
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
              <Typography>From: JSAN OpsDesk &lt;{status.senderEmail}&gt;</Typography>
              {status.account ? (
                <Alert severity="success">
                  Connected: {status.account.email} (
                  {labels[status.account.provider] ?? status.account.provider})
                </Alert>
              ) : (
                <Alert severity="info">
                  The shared mailbox needs one-time authorization. Ticket updates are saved, but
                  emails cannot be delivered until a super admin connects this mailbox.
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
                  Disconnect shared mailbox
                </Button>
              )}
              <Typography variant="caption">
                Disconnecting stops shared email delivery for everyone. It removes the credentials
                saved in OpsDesk; you can also revoke access in the mailbox provider's settings.
              </Typography>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
