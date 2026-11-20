import { useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { Alert, Button, Stack, Typography } from "@mui/material";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import { apiGet } from "../api/client";
import { hasMatchingSendingEmail, type SendingMailStatus } from "../api/sendingMail";

/**
 * The confirmation a user lands on after the mail provider answers: green when
 * the mailbox is connected, red with a way straight back to it when it isn't.
 * Rendered on the home page of every role, so the outcome of the connection
 * is visible wherever they end up.
 */
export function SendingEmailResult() {
  const [params, setParams] = useSearchParams();
  const result = params.get("result");
  if (result !== "connected" && result !== "failed") return null;
  const clear = () => {
    params.delete("result");
    setParams(params, { replace: true });
  };
  return (
    <Alert
      severity={result === "connected" ? "success" : "error"}
      onClose={clear}
      sx={{ mb: 2 }}
      action={
        result === "failed" ? (
          <Button color="inherit" component={RouterLink} to="/account/email" size="small">
            Retry
          </Button>
        ) : undefined
      }
    >
      {result === "connected"
        ? "Your sending email is connected. Emails you trigger will now come from your address."
        : "Your mailbox could not be connected. Nothing else is blocked — retry whenever you are ready."}
    </Alert>
  );
}

/**
 * A one-line reminder of the mailbox state for the signed-in user. Quiet when
 * the mailbox is connected, and a way to fix it when it isn't — the same
 * check the sign-in step makes, so nobody discovers a broken sender only
 * when a ticket email fails to arrive.
 */
export function SendingEmailStatus({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<SendingMailStatus | null>(null);
  useEffect(() => {
    let live = true;
    apiGet<SendingMailStatus>("/sending-mail")
      .then((next) => {
        if (live) setStatus(next);
      })
      // A missing or unreadable status is not worth an error banner of its
      // own — the sign-in step is where the user actually connects.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!status) return null;
  if (hasMatchingSendingEmail(status))
    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <MailOutlineIcon fontSize="small" color="success" />
        <Typography variant="body2" color="text.secondary">
          Sending email connected as {status.account?.email}
        </Typography>
      </Stack>
    );
  return (
    <Alert
      severity="info"
      sx={{ mb: 2 }}
      action={
        <Button color="inherit" component={RouterLink} to="/account/email" size="small">
          Connect
        </Button>
      }
    >
      {compact
        ? "Your sending email is not connected yet."
        : "Your sending email is not connected yet. Ticket and record emails you trigger will fail until you connect the mailbox matching your registered address."}
    </Alert>
  );
}
