import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ApiError, apiPost, storeToken } from "../api/client";
import { landingPathFor } from "../api/jwt";

interface TokenInfo {
  email: string;
  displayName: string;
  purpose: "INVITE" | "RESET";
}

const MIN_LENGTH = 12;

/**
 * Where invite and reset emails land (`/auth/set-password#token=...`). The
 * token lives in the URL fragment — never sent to a server or leaked via
 * Referer — and is moved into memory and wiped from the address bar first.
 */
export function SetPasswordPage() {
  const navigate = useNavigate();
  const token = useRef<string | null>(null);
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token.current === null) {
      token.current = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (!token.current) {
      setLinkError("This link is incomplete. Open it again from your email.");
      return;
    }
    apiPost<TokenInfo>("/auth/password/inspect", { token: token.current })
      .then(setInfo)
      .catch(() =>
        setLinkError("This link has expired or was already used. Ask for a new one below."),
      );
  }, []);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSave = password.length >= MIN_LENGTH && confirm === password && !saving;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave || !token.current) return;
    setSaving(true);
    setError(null);
    try {
      const { accessToken } = await apiPost<{ accessToken: string }>("/auth/password/set", {
        token: token.current,
        password,
      });
      storeToken(accessToken);
      navigate(landingPathFor(accessToken), { replace: true });
    } catch (err) {
      const message =
        err instanceof ApiError ? (err.body as { message?: unknown } | null)?.message : undefined;
      setError(typeof message === "string" ? message : "Couldn't save your password. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box
      sx={{ minHeight: "100vh", display: "grid", placeItems: "center", px: 2, bgcolor: "#f5f7fa" }}
    >
      <Card
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 440,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 3,
        }}
      >
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          {linkError ? (
            <Stack spacing={2}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                Link not valid
              </Typography>
              <Alert severity="error">{linkError}</Alert>
              <Typography variant="body2" color="text.secondary">
                On the sign-in page, choose "Forgot password?" to get a new link, or ask your
                OpsDesk administrator to resend your invite.
              </Typography>
              <Button component={RouterLink} to="/login" variant="contained">
                Go to sign-in
              </Button>
            </Stack>
          ) : !info ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box component="form" onSubmit={save} noValidate>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="h5" sx={{ fontWeight: 700 }}>
                    {info.purpose === "INVITE"
                      ? "Welcome to JSAN OpsDesk"
                      : "Choose a new password"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {info.purpose === "INVITE"
                      ? `Hi ${info.displayName} — choose a password for ${info.email}.`
                      : `For ${info.email}. You'll be signed out everywhere else.`}
                  </Typography>
                </Box>
                {error && <Alert severity="error">{error}</Alert>}
                {/* Hidden username field so password managers save the right account. */}
                <input type="email" autoComplete="username" value={info.email} readOnly hidden />
                <TextField
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  error={tooShort}
                  helperText={`At least ${MIN_LENGTH} characters. A few unrelated words make a strong, memorable password.`}
                  autoFocus
                  fullWidth
                />
                <TextField
                  label="Confirm password"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  error={mismatch}
                  helperText={mismatch ? "Passwords don't match" : " "}
                  fullWidth
                />
                <Button type="submit" variant="contained" size="large" disabled={!canSave}>
                  {saving ? "Saving…" : "Save password and sign in"}
                </Button>
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
