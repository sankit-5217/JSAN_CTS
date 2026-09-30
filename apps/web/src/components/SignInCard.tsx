import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
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
import { ApiError, apiGet, apiPost, socialLoginUrl, storeToken } from "../api/client";
import { landingPathFor } from "../api/jwt";
import { theme } from "../theme/theme";

/** GET /auth/providers */
interface AuthProviders {
  password: boolean;
  social: { id: string; label: string }[];
}

interface TokenResponse {
  accessToken: string;
}

// Reasons the API's social callback can bounce back with (`?social_error=`).
const SOCIAL_ERROR_MESSAGES: Record<string, string> = {
  not_provisioned:
    "There's no OpsDesk account for that email. Ask an OpsDesk administrator to add you, or sign in with the account you were invited with.",
  inactive: "Your OpsDesk account is deactivated. Contact an OpsDesk administrator.",
  identity_mismatch:
    "A different account from this provider is already linked to your OpsDesk user. Use that one, or sign in with your password.",
  email_missing: "The provider didn't share an email address, so we can't match you to an account.",
  email_unverified:
    "Your email address isn't verified with that provider. Verify it there, then try again.",
  provider_error: "Sign-in was cancelled or refused by the provider.",
  invalid_state: "Your sign-in attempt expired. Please try again.",
  provider_unavailable:
    "That provider is unreachable right now. Try again shortly, or use your password.",
  provider_disabled: "That sign-in option isn't available here.",
  login_failed: "Sign-in failed. Please try again.",
};

const PROVIDER_ICONS: Record<string, ReactNode> = {
  google: (
    <svg viewBox="0 0 48 48" width={19} height={19} aria-hidden>
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.6H24v9h11.8c-.5 2.7-2.1 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.5 6.6-16.5Z"
      />
      <path
        fill="#34A853"
        d="M24 46c6 0 11-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8 41 15.4 46 24 46Z"
      />
      <path
        fill="#FBBC05"
        d="M11.8 28.2A13.6 13.6 0 0 1 11.1 24c0-1.5.3-2.9.7-4.2v-5.7H4.5A22 22 0 0 0 2 24c0 3.5.8 6.9 2.5 9.9l7.3-5.7Z"
      />
      <path
        fill="#EA4335"
        d="M24 10.7c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C34.9 4.2 30 2 24 2 15.4 2 8 7 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9.1 12.2-9.1Z"
      />
    </svg>
  ),
  microsoft: (
    <svg viewBox="0 0 21 21" width={17} height={17} aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" width={19} height={19} fill="#181717" aria-hidden>
      <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2 0 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.4-1.3-5.4-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.7 5.6-5.4 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
    </svg>
  ),
};

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
 * The sign-in card: Google / Microsoft / GitHub (whichever the API has
 * configured) and email + password, with self-service password reset.
 */
export function SignInCard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const socialError = searchParams.get("social_error");

  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [providersFailed, setProvidersFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  useEffect(() => {
    apiGet<AuthProviders>("/auth/providers")
      .then(setProviders)
      .catch(() => {
        // API unreachable: password sign-in still renders; it'll report the error on submit.
        setProviders({ password: true, social: [] });
        setProvidersFailed(true);
      });
  }, []);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await apiPost<TokenResponse>("/auth/login", {
        email: email.trim(),
        password,
      });
      storeToken(accessToken);
      navigate(landingPathFor(accessToken));
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
        Use the email your OpsDesk administrator invited.
      </Typography>

      {socialError && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
          {SOCIAL_ERROR_MESSAGES[socialError] ?? SOCIAL_ERROR_MESSAGES.login_failed}
        </Alert>
      )}
      {providersFailed && (
        <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
          Can't reach the OpsDesk server right now.
        </Alert>
      )}

      {providers === null ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size={22} />
        </Box>
      ) : (
        <>
          {providers.social.length > 0 && (
            <>
              <Stack spacing={1.1} sx={{ mb: 2.5 }}>
                {providers.social.map((p) => (
                  <Button
                    key={p.id}
                    fullWidth
                    // Full-page navigation: the API redirects on to the provider.
                    href={socialLoginUrl(p.id)}
                    startIcon={PROVIDER_ICONS[p.id]}
                    sx={{
                      justifyContent: "flex-start",
                      gap: 0.5,
                      py: 1.1,
                      px: 2,
                      borderRadius: 2,
                      border: "1px solid",
                      borderColor: "divider",
                      textTransform: "none",
                      fontWeight: 600,
                      fontSize: 14,
                      color: "text.primary",
                    }}
                  >
                    Continue with {p.label}
                  </Button>
                ))}
              </Stack>
              <Divider sx={{ mb: 2.5, fontSize: 12, color: "text.secondary" }}>
                or use your password
              </Divider>
            </>
          )}

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
      )}

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
