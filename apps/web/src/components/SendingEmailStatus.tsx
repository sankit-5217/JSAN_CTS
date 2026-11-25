import { useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { Alert, Button } from "@mui/material";
import { apiGet } from "../api/client";
import { hasMatchingSendingEmail, type SendingMailStatus } from "../api/sendingMail";

/**
 * Successful connections need no further UI. Failed provider callbacks keep
 * a retry action on the user's home page.
 */
export function SendingEmailResult() {
  const [params, setParams] = useSearchParams();
  const result = params.get("result");
  useEffect(() => {
    if (result === "connected") {
      const next = new URLSearchParams(params);
      next.delete("result");
      setParams(next, { replace: true });
    }
  }, [params, result, setParams]);
  if (result !== "failed") return null;
  const clear = () => {
    params.delete("result");
    setParams(params, { replace: true });
  };
  return (
    <Alert
      severity="error"
      onClose={clear}
      sx={{ mb: 2 }}
      action={
        <Button color="inherit" component={RouterLink} to="/account/email" size="small">
          Retry
        </Button>
      }
    >
      Your mailbox could not be connected. Nothing else is blocked — retry whenever you are ready.
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
  if (!status || hasMatchingSendingEmail(status)) return null;
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
