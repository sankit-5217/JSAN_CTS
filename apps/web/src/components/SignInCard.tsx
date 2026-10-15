import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import LoginOutlinedIcon from "@mui/icons-material/LoginOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { ApiError, apiPost, storeToken } from "../api/client";
import { landingPathFor } from "../api/jwt";
import { theme } from "../theme/theme";

interface TokenResponse {
  accessToken: string;
  /** An admin set this password: choose your own before anything else. */
  mustChangePassword?: boolean;
}

/** The server's own explanation from an ApiError, without the "POST /x failed: 401 — " prefix. */
function serverMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const message = (err.body as { message?: unknown } | null)?.message;
    if (typeof message === "string") return message;
    if (err.status === 429) return "Too many attempts. Wait a minute and try again.";
  }
  return "Something went wrong. Please try again.";
}

/**
 * The sign-in card: email + password (the only way in), with self-service
 * password reset. A password set by an admin leads straight to choosing
 * your own.
 */
export function SignInCard() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const { accessToken, mustChangePassword } = await apiPost<TokenResponse>("/auth/login", {
        email: email.trim(),
        password,
      });
      storeToken(accessToken);
      navigate(mustChangePassword ? "/auth/change-password" : landingPathFor(accessToken));
    } catch (err) {
      setError(serverMessage(err));
      setPassword("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Typography
        sx={{
          color: theme.palette.secondary.dark,
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: "0.08em",
          mb: 0.75,
        }}
      >
        OPS PLATFORM
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
        Sign in to JSAN OpsDesk
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        Use the email and password from your OpsDesk administrator.
      </Typography>

      <>
        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
            {error}
          </Alert>
        )}

        <Box component="form" onSubmit={signIn} noValidate>
          <Stack spacing={2}>
            <TextField
              id="signin-email"
              label="Work email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              fullWidth
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
            />
            <TextField
              id="signin-password"
              label="Password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              fullWidth
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((v) => !v)}
                      edge="end"
                      size="small"
                    >
                      {showPassword ? (
                        <VisibilityOffOutlinedIcon fontSize="small" />
                      ) : (
                        <VisibilityOutlinedIcon fontSize="small" />
                      )}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <Box sx={{ textAlign: "right", mt: "-6px !important" }}>
              <Link
                component="button"
                type="button"
                variant="body2"
                onClick={() => setForgotOpen(true)}
              >
                Forgot password?
              </Link>
            </Box>
            <Button
              type="submit"
              variant="contained"
              fullWidth
              size="large"
              disabled={loading || !email.trim() || !password}
              startIcon={
                loading ? (
                  <CircularProgress size={16} sx={{ color: "inherit" }} />
                ) : (
                  <LoginOutlinedIcon />
                )
              }
              sx={{
                borderRadius: 2,
                py: 1.1,
                textTransform: "none",
                fontWeight: 600,
                fontSize: 15,
                boxShadow: "none",
                "&:hover": { boxShadow: "0 8px 20px -8px rgba(15, 61, 99, 0.5)" },
              }}
            >
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </Stack>
        </Box>
      </>

      {forgotOpen && (
        <ForgotPasswordDialog initialEmail={email} onClose={() => setForgotOpen(false)} />
      )}
    </>
  );
}

function ForgotPasswordDialog({
  initialEmail,
  onClose,
}: {
  initialEmail: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(initialEmail.trim());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await apiPost("/auth/password/forgot", { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(serverMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onClose={sending ? undefined : onClose} fullWidth maxWidth="xs">
      <Box component="form" onSubmit={send} noValidate>
        <DialogTitle>Reset your password</DialogTitle>
        <DialogContent>
          {sent ? (
            <Alert severity="success">
              If {email.trim()} has an OpsDesk account, a reset link is on its way. It works once,
              for one hour. Check your spam folder if it doesn't arrive.
            </Alert>
          ) : (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                Enter your work email and we'll send you a link to choose a new password.
              </Typography>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label="Work email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                fullWidth
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={sending}>
            {sent ? "Done" : "Cancel"}
          </Button>
          {!sent && (
            <Button type="submit" variant="contained" disabled={sending || !email.trim()}>
              {sending ? "Sending…" : "Send reset link"}
            </Button>
          )}
        </DialogActions>
      </Box>
    </Dialog>
  );
}
