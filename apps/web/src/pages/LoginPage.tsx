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
  MenuItem,
  Stack,
  TextField,
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

function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: "10px",
        bgcolor: ACCENT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        fontSize: size * 0.4,
        color: PANEL_BG,
        flexShrink: 0,
      }}
    >
      OD
    </Box>
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
        <Stack direction="row" spacing={1.5} alignItems="center">
          <BrandMark />
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>OpsDesk</Typography>
            <Typography
              sx={{ color: alpha("#ffffff", 0.5), fontSize: 10.5, letterSpacing: "0.06em" }}
            >
              DATA CENTER OPS
            </Typography>
          </Box>
        </Stack>

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
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            sx={{ mb: 3, display: { xs: "flex", md: "none" } }}
          >
            <BrandMark size={40} />
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: 17 }}>OpsDesk</Typography>
              <Typography sx={{ color: "text.secondary", fontSize: 11, letterSpacing: "0.06em" }}>
                DATA CENTER OPS
              </Typography>
            </Box>
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
                Sign in to OpsDesk
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
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
