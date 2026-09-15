import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, darken } from "@mui/material/styles";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import LoginOutlinedIcon from "@mui/icons-material/LoginOutlined";
import NotificationsActiveOutlinedIcon from "@mui/icons-material/NotificationsActiveOutlined";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import { apiPost, storeToken } from "../api/client";
import { decodeJwtPayload } from "../api/jwt";
import { theme } from "../theme/theme";

interface DevLoginResponse {
  accessToken: string;
}

// No OAuth app is registered yet (no client id/secret for any provider, no
// passport strategy on the backend) — these render disabled with a "Soon"
// chip rather than being left out, so the intended sign-in surface is real
// but never pretends to work. Swap in real handlers once credentials exist.
const SOCIAL_PROVIDERS = [
  {
    name: "Google",
    icon: (
      <svg viewBox="0 0 48 48" width={19} height={19}>
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
  },
  {
    name: "GitHub",
    icon: (
      <svg viewBox="0 0 24 24" width={19} height={19} fill="#181717">
        <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2 0 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.4-1.3-5.4-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.7 5.6-5.4 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
      </svg>
    ),
  },
  {
    name: "Apple",
    icon: (
      <svg viewBox="0 0 24 24" width={19} height={19} fill="#000">
        <path d="M16.7 1c.1 1.2-.4 2.4-1.1 3.2-.7.9-1.9 1.6-3 1.5-.1-1.2.5-2.4 1.2-3.2C14.5 1.6 15.7 1 16.7 1Zm3.9 16.9c-.5 1.2-.8 1.7-1.5 2.7-1 1.4-2.3 3.2-4 3.2-1.5 0-1.9-1-3.9-1s-2.5 1-4 1c-1.7 0-3-1.6-4-3-1.7-2.5-3-7-1.2-10 .9-1.5 2.4-2.5 4.1-2.5 1.6 0 2.6 1 3.9 1 1.3 0 2.1-1 3.9-1 1.4 0 3 .8 4 2.1-3.5 1.9-2.9 6.8 1.7 8.5Z" />
      </svg>
    ),
  },
];

// Same dark-navy-derived-from-primary palette as the app shell's sidebar
// (App.tsx) — each page derives its own tokens from theme/theme.ts rather
// than importing another page's private constants (CommandCenterPage's
// HEALTH_COLOR follows the same pattern).
const PANEL_BG = darken(theme.palette.primary.main, 0.45);
const ACCENT = theme.palette.secondary.light;

// Matches apps/api/prisma/seed.ts's seeded users — a convenience dropdown,
// not a hard-coded allowlist (any active user's email works via dev-login).
const SEEDED_USERS = [
  {
    email: "admin@example.com",
    role: "SUPER_ADMIN",
    scope: "All sites",
    note: "Full platform access, including admin configuration.",
  },
  {
    email: "servicedesk@example.com",
    role: "SERVICE_DESK_NOC",
    scope: "SITE01",
    note: "Triage, acknowledge, route and update incidents.",
  },
  {
    email: "engineer1@example.com",
    role: "SITE_ENGINEER",
    scope: "SITE01",
    note: "Hands-on floor engineering and hardware actions.",
  },
  {
    email: "engineer@example.com",
    role: "SITE_ENGINEER",
    scope: "SITE02",
    note: "Hands-on floor engineering and hardware actions.",
  },
  {
    email: "ctsviewer@example.com",
    role: "CTS_MANAGER_VIEWER",
    scope: "SITE01",
    note: "Read-only: no internal comments, no management IPs, nothing editable.",
  },
];

// What the left brand panel advertises — module ownership pulled straight
// from CLAUDE.md's Dev A/Dev B split, same icon set as the sidebar nav.
const CAPABILITIES = [
  {
    icon: <ReportProblemOutlinedIcon fontSize="small" />,
    label: "Incidents",
    detail: "Triage, assign and track SLA in real time",
  },
  {
    icon: <DnsOutlinedIcon fontSize="small" />,
    label: "CMDB",
    detail: "Every CI, rack and relationship in one registry",
  },
  {
    icon: <NotificationsActiveOutlinedIcon fontSize="small" />,
    label: "Alerts",
    detail: "Normalized signals from Redfish, SNMP and monitoring",
  },
  {
    icon: <ScheduleOutlinedIcon fontSize="small" />,
    label: "SLA & escalations",
    detail: "Policy-driven timers, never hard-coded",
  },
];

/** `on="dark"` (the brand panel) gets the white logo lockup; `on="light"`
 *  (the mobile compact header, on the page's light background) gets the
 *  full-color one — same two PNGs the internal sidebar and client portal
 *  header use, so the mark is identical everywhere it appears. */
function BrandMark({ height = 24, on = "dark" }: { height?: number; on?: "dark" | "light" }) {
  return (
    <Box
      component="img"
      src={on === "dark" ? "/jsan-logo-white.png" : "/jsan-logo.png"}
      alt="JSAN"
      sx={{ height, width: "auto", display: "block" }}
    />
  );
}

/**
 * Dev-mode login (Sprint 7 plan, Decision 4) — wraps the existing
 * `POST /auth/dev-login` (server-side disabled outside dev/local) behind a
 * real UI instead of a browser-console snippet. Real OIDC login is a
 * separate, later piece of work; this page goes away once that lands.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(SEEDED_USERS[0].email);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const selectedUser = SEEDED_USERS.find((u) => u.email === email);

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await apiPost<DevLoginResponse>("/auth/dev-login", { email });
      storeToken(accessToken);
      const role = decodeJwtPayload(accessToken)?.role;
      navigate(role === "CTS_MANAGER_VIEWER" ? "/client/report" : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      {/* Brand panel — desktop/tablet only; mobile gets a compact header instead. */}
      <Box
        sx={{
          display: { xs: "none", md: "flex" },
          flexDirection: "column",
          justifyContent: "space-between",
          width: "42%",
          maxWidth: 480,
          p: 6,
          bgcolor: PANEL_BG,
          backgroundImage: `radial-gradient(circle at 15% 8%, ${alpha(ACCENT, 0.16)}, transparent 45%)`,
          color: "#fff",
        }}
      >
        <BrandMark height={36} />

        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1.5, lineHeight: 1.25 }}>
            One console for the floor and the desk.
          </Typography>
          <Typography sx={{ color: alpha("#ffffff", 0.65), mb: 4, maxWidth: 360 }}>
            Ticketing, CMDB, monitoring and governance for CTS/JSAN data-center operations —
            backend-enforced access, every change audited.
          </Typography>
          <Stack spacing={2.5}>
            {CAPABILITIES.map((cap) => (
              <Stack key={cap.label} direction="row" spacing={1.75} alignItems="flex-start">
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 30,
                    height: 30,
                    borderRadius: "8px",
                    bgcolor: alpha("#ffffff", 0.08),
                    color: ACCENT,
                    flexShrink: 0,
                  }}
                >
                  {cap.icon}
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{cap.label}</Typography>
                  <Typography sx={{ color: alpha("#ffffff", 0.55), fontSize: 12.5 }}>
                    {cap.detail}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>

        <Typography sx={{ color: alpha("#ffffff", 0.4), fontSize: 11.5 }}>
          Local/dev environment — real SSO lands in a later sprint.
        </Typography>
      </Box>

      {/* Sign-in panel */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          p: { xs: 3, sm: 6 },
          bgcolor: "#f5f7fa",
        }}
      >
        <Box sx={{ width: "100%", maxWidth: 420 }}>
          <Stack spacing={0.75} sx={{ mb: 3, display: { xs: "flex", md: "none" } }}>
            <BrandMark height={32} on="light" />
            <Typography sx={{ color: "text.secondary", fontSize: 11, letterSpacing: "0.06em" }}>
              CTS DATA CENTER OPSDESK
            </Typography>
          </Stack>

          <Card
            elevation={0}
            sx={{
              borderRadius: 3,
              border: "1px solid",
              borderColor: "divider",
              boxShadow: "0 12px 32px -16px rgba(15, 61, 99, 0.25)",
            }}
          >
            <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
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
                Sign in to JSAN CTS OpsDesk
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                Continue with your organization account, or use email below.
              </Typography>

              <Stack spacing={1.1} sx={{ mb: 2.5 }}>
                {SOCIAL_PROVIDERS.map((provider) => (
                  <Tooltip
                    key={provider.name}
                    title={`${provider.name} sign-in isn't wired up yet — use email below.`}
                  >
                    <span>
                      <Button
                        fullWidth
                        disabled
                        startIcon={provider.icon}
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
                          "&.Mui-disabled": { color: "text.primary", opacity: 0.6 },
                        }}
                      >
                        <Box component="span" sx={{ flex: 1, textAlign: "left" }}>
                          Continue with {provider.name}
                        </Box>
                        <Chip
                          size="small"
                          label="Soon"
                          sx={{
                            height: 20,
                            fontSize: 10.5,
                            fontWeight: 600,
                            bgcolor: alpha(theme.palette.text.primary, 0.06),
                          }}
                        />
                      </Button>
                    </span>
                  </Tooltip>
                ))}
              </Stack>

              <Divider sx={{ mb: 2.5, fontSize: 12, color: "text.secondary" }}>
                or continue with email
              </Divider>

              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Dev-mode sign-in — pick a seeded user, no password. Disabled server-side outside
                local/dev.
              </Typography>

              {error && (
                <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                  Sign-in failed: {error}
                </Alert>
              )}

              <TextField
                select
                fullWidth
                label="User"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                sx={{ mb: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
              >
                {SEEDED_USERS.map((user) => (
                  <MenuItem key={user.email} value={user.email}>
                    {user.email} ({user.role}, {user.scope})
                  </MenuItem>
                ))}
              </TextField>

              {selectedUser && (
                <Box
                  sx={{
                    mb: 3,
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: alpha(theme.palette.primary.main, 0.05),
                    border: "1px solid",
                    borderColor: alpha(theme.palette.primary.main, 0.12),
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <Chip
                      size="small"
                      label={selectedUser.role}
                      sx={{
                        bgcolor: alpha(theme.palette.primary.main, 0.12),
                        color: theme.palette.primary.main,
                        fontWeight: 600,
                      }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {selectedUser.scope}
                    </Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {selectedUser.note}
                  </Typography>
                </Box>
              )}

              <Button
                variant="contained"
                fullWidth
                size="large"
                disabled={loading}
                onClick={handleLogin}
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
            </CardContent>
          </Card>
        </Box>
      </Box>
    </Box>
  );
}
