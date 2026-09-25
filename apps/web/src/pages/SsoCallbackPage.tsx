import { useEffect, useRef, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { apiPost, storeToken } from "../api/client";
import { decodeJwtPayload } from "../api/jwt";

interface ExchangeResponse {
  accessToken: string;
}

/**
 * Landing page after the API's OIDC callback: the URL fragment carries a
 * 60-second, single-use code, which is traded for the app JWT. The fragment
 * never reaches a server or a Referer header, and is wiped from the address
 * bar/history before anything else happens.
 */
export function SsoCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  // The code is single-use — guard against StrictMode's double effect run.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const code = new URLSearchParams(window.location.hash.slice(1)).get("code");
    window.history.replaceState(null, "", window.location.pathname);
    if (!code) {
      setError("This sign-in link is missing its code.");
      return;
    }

    apiPost<ExchangeResponse>("/auth/oidc/exchange", { code })
      .then(({ accessToken }) => {
        storeToken(accessToken, "sso");
        const role = decodeJwtPayload(accessToken)?.role;
        navigate(role === "CLIENT_MANAGER_VIEWER" ? "/client/report" : "/", { replace: true });
      })
      .catch(() => setError("This sign-in link has expired or was already used."));
  }, [navigate]);

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", px: 2 }}>
      {error ? (
        <Stack spacing={2} sx={{ maxWidth: 420, width: "100%" }}>
          <Alert severity="error">{error}</Alert>
          <Button component={RouterLink} to="/login" variant="contained">
            Back to sign-in
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2} alignItems="center">
          <CircularProgress />
          <Typography color="text.secondary">Signing you in…</Typography>
        </Stack>
      )}
    </Box>
  );
}
