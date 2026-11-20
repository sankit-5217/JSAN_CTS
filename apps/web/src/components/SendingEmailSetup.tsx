import { useCallback, useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { apiDelete, apiGet, apiPost, getStoredToken, ApiError } from "../api/client";
import {
  hasMatchingSendingEmail,
  MAIL_PROVIDER_LABELS,
  type SendingMailStatus,
} from "../api/sendingMail";

export interface SendingEmailSetupProps {
  /** Called once a matching mailbox is connected, to move on to the portal. */
  onContinue?: () => void;
  /** Where the user returns after the provider answers (their own home). */
  next?: string;
}

/**
 * The one mailbox step every role shares — clients, service desk, engineers
 * and admins all meet it in the same place, right after sign-in, with their
 * registered email already matched for them. The provider buttons send the
 * user to their own home afterwards, so connecting never becomes an extra
 * screen between signing in and working.
 */
export function SendingEmailSetup({ onContinue, next }: SendingEmailSetupProps) {
  const [status, setStatus] = useState<SendingMailStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [smtpProvider, setSmtpProvider] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
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
      const nextStatus = await apiGet<SendingMailStatus>("/sending-mail");
      setStatus(nextStatus);
      if (onContinue && hasMatchingSendingEmail(nextStatus)) onContinue();
    } catch (err) {
      failure(err);
    }
  }, [onContinue]);
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
  const connectUrl = (provider: string) =>
    `/sending-mail/connect/${provider}${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  const labels = MAIL_PROVIDER_LABELS;
  // An older API answer simply has no app-password providers; the step still
  // works with the OAuth ones.
  const smtpProviders = status?.smtpProviders ?? [];
  return (
    <Box>
      {onContinue && (
        <Alert severity="success" sx={{ mb: 2 }}>
          You are signed in. Connect your sending email here before continuing to OpsDesk.
        </Alert>
      )}
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
          <Button color="inherit" disabled={busy} onClick={() => void run(load)} sx={{ ml: 1.5 }}>
            Retry
          </Button>
        </Alert>
      )}
      {!status && !error && <CircularProgress aria-label="Loading email account" />}
      {status && (
        <Stack spacing={2}>
          <Typography>Your registered email: {status.senderEmail}</Typography>
          {hasMatchingSendingEmail(status) && status.account ? (
            <Alert severity="success">
              From: {status.account.email} (
              {labels[status.account.provider] ?? status.account.provider})
            </Alert>
          ) : (
            <Alert severity="info">
              Connect your registered mailbox to send emails when you update tickets or other
              records. Updates will still be saved, but email delivery will fail until you connect
              it.
            </Alert>
          )}
          {status.providers.map((p) => (
            <Box key={p.provider}>
              <Button
                variant="outlined"
                disabled={busy || !p.configured}
                onClick={() =>
                  void run(async () => {
                    const { url } = await apiPost<{ url: string }>(connectUrl(p.provider));
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
          {smtpProviders.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Or connect with an app password
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
                {smtpProviders.map((p) => (
                  <Button
                    key={p.provider}
                    size="small"
                    variant={smtpProvider === p.provider ? "contained" : "outlined"}
                    disabled={busy}
                    onClick={() => setSmtpProvider(p.provider)}
                  >
                    {labels[p.provider] ?? p.provider}
                  </Button>
                ))}
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small"
                  type="password"
                  label="App password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  helperText="Your provider's app password, not your account password."
                />
                <Button
                  variant="outlined"
                  disabled={busy || !smtpProvider || !smtpPassword}
                  onClick={() =>
                    void run(async () => {
                      await apiPost("/sending-mail/smtp", {
                        provider: smtpProvider,
                        password: smtpPassword,
                      });
                      setSmtpPassword("");
                      await load();
                    })
                  }
                >
                  Connect with app password
                </Button>
              </Stack>
            </Box>
          )}
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
            Disconnecting removes only your saved credentials. You can also revoke access in your
            mailbox provider's settings.
          </Typography>
        </Stack>
      )}
      {onContinue && (
        <Button onClick={onContinue} disabled={busy} sx={{ mt: 2 }}>
          Continue without connecting
        </Button>
      )}
    </Box>
  );
}
