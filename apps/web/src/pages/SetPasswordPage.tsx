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

const INCOMPLETE =
  "This link is incomplete — the part after # didn't arrive. Paste the whole link from your email below.";

/** The token from a fragment ("#token=...") or from a whole pasted link. */
function tokenFrom(text: string): string {
  const hash = text.includes("#") ? text.slice(text.indexOf("#") + 1) : text;
  return new URLSearchParams(hash.trim()).get("token")?.trim() ?? "";
}

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

  const [pasted, setPasted] = useState("");

  const checkToken = (value: string) => {
    token.current = value;
    setLinkError(null);
    setInfo(null);
    apiPost<TokenInfo>("/auth/password/inspect", { token: value })
      .then(setInfo)
      .catch(() =>
        setLinkError("This link has expired or was already used. Ask for a new one below."),
      );
  };

  useEffect(() => {
    // Pasting the full link into a tab already on this page only changes the
    // fragment — no reload — so pick the token up from hashchange too.
    const readHash = () => {
      const fromHash = tokenFrom(window.location.hash);
      if (fromHash) {
        window.history.replaceState(null, "", window.location.pathname);
        checkToken(fromHash);
      }
    };
    if (token.current === null) {
      token.current = "";
      readHash();
      if (!token.current) {
        setLinkError(INCOMPLETE);
      }
    }
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
              {linkError === INCOMPLETE && (
                <Box
                  component="form"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    const value = tokenFrom(pasted);
                    if (value) checkToken(value);
                  }}
                >
                  <Stack spacing={1.5}>
                    <TextField
                      label="Paste the link from your email"
                      value={pasted}
                      onChange={(e) => setPasted(e.target.value)}
                      placeholder="https://…/auth/set-password#token=…"
                      autoComplete="off"
                      fullWidth
                    />
                    <Button type="submit" variant="outlined" disabled={!tokenFrom(pasted)}>
                      Continue
                    </Button>
                  </Stack>
                </Box>
              )}
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
