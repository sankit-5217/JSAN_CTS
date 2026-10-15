import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
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
import { ApiError, apiPost, getStoredToken, signOut, storeToken } from "../api/client";
import { decodeJwtPayload, landingPathFor, passwordChangeRequired } from "../api/jwt";

const MIN_LENGTH = 12;

/**
 * Change your own password. Required right after signing in with a password
 * an admin set (the API refuses everything else until then); also reachable
 * any time from the account menu. Needs the current password.
 */
export function ChangePasswordPage() {
  const navigate = useNavigate();
  const token = getStoredToken();
  const required = passwordChangeRequired();
  const email = token ? (decodeJwtPayload(token)?.email ?? "") : "";
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) return <Navigate to="/login" replace />;

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSave =
    current.length > 0 && password.length >= MIN_LENGTH && confirm === password && !saving;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const { accessToken } = await apiPost<{ accessToken: string }>("/auth/password/change", {
        currentPassword: current,
        newPassword: password,
      });
      storeToken(accessToken);
      navigate(landingPathFor(accessToken), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        signOut();
        return;
      }
      const message =
        err instanceof ApiError ? (err.body as { message?: unknown } | null)?.message : undefined;
      setError(typeof message === "string" ? message : "Couldn't change your password. Try again.");
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
          <Box component="form" onSubmit={save} noValidate>
            <Stack spacing={2}>
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                  {required ? "Choose your own password" : "Change password"}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {required
                    ? `Your administrator set a starting password for ${email}. Choose a new one to continue.`
                    : `For ${email}. You'll be signed out everywhere else.`}
                </Typography>
              </Box>
              {error && <Alert severity="error">{error}</Alert>}
              {/* Hidden username field so password managers save the right account. */}
              <input type="email" autoComplete="username" value={email} readOnly hidden />
              <TextField
                label={required ? "Starting password" : "Current password"}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoFocus
                fullWidth
              />
              <TextField
                label="New password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={tooShort}
                helperText={`At least ${MIN_LENGTH} characters. A few unrelated words make a strong, memorable password.`}
                fullWidth
              />
              <TextField
                label="Confirm new password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                error={mismatch}
                helperText={mismatch ? "Doesn't match" : " "}
                fullWidth
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={!canSave}
                startIcon={
                  saving ? <CircularProgress size={16} sx={{ color: "inherit" }} /> : undefined
                }
              >
                {saving ? "Saving…" : "Save password"}
              </Button>
              {required ? (
                <Button onClick={signOut} disabled={saving}>
                  Sign out
                </Button>
              ) : (
                <Button onClick={() => navigate(-1)} disabled={saving}>
                  Cancel
                </Button>
              )}
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
