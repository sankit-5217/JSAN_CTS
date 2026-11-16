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
            Your sending email
          </Typography>
          <Typography sx={{ mb: 2 }}>
            Connect the mailbox that matches your registered OpsDesk email. Emails triggered by your
            updates will be sent from your address. Each user connects their own mailbox.
          </Typography>
          {query.get("result") === "connected" && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Your sending mailbox is connected.
            </Alert>
          )}
          {query.get("result") === "failed" && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Email authorization failed. Sign in to the mailbox matching your registered email and
              grant permission to send email, then try again.
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
              <Typography>Your registered email: {status.senderEmail}</Typography>
              {status.account ? (
                <Alert severity="success">
                  From: {status.account.email} (
                  {labels[status.account.provider] ?? status.account.provider})
                </Alert>
              ) : (
                <Alert severity="info">
                  Connect your registered mailbox to send emails when you update tickets or other
                  records. Updates will still be saved, but email delivery will fail until you
                  connect it.
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
                  Disconnect sending email
                </Button>
              )}
              <Typography variant="caption">
                Disconnecting removes only your saved credentials. You can also revoke access in
                your mailbox provider's settings.
              </Typography>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
