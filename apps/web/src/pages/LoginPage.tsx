import { useState, type FormEvent } from "react";
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
  Grid,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, darken, keyframes } from "@mui/material/styles";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import LoginOutlinedIcon from "@mui/icons-material/LoginOutlined";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import NotificationsActiveOutlinedIcon from "@mui/icons-material/NotificationsActiveOutlined";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import SecurityOutlinedIcon from "@mui/icons-material/SecurityOutlined";
import VerifiedUserOutlinedIcon from "@mui/icons-material/VerifiedUserOutlined";
import { apiPost, storeToken } from "../api/client";
import { decodeJwtPayload } from "../api/jwt";
import { severityColors, theme } from "../theme/theme";

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

// The sequence really is a sequence — sign-in resolves scope before anything
// else can happen, so the numbering carries real information, not decoration.
const HOW_IT_WORKS = [
  {
    title: "Sign in once",
    detail: "Role and site scope resolve automatically — you see only what you're cleared for.",
  },
  {
    title: "Work lands in your queue",
    detail: "Alerts correlate to CIs and open tickets automatically. Nothing sits unowned.",
  },
  {
    title: "Work it, timed",
    detail:
      "SLA clocks run against policy, not guesswork. A pause or resume is logged, not assumed.",
  },
  {
    title: "Every change is on record",
    detail: "Approvals, transitions and edits write an audit trail you can hand to an auditor.",
  },
];

// Module ownership straight from CLAUDE.md's table — same six domains, same
// split, just written for someone deciding whether to sign in, not a dev.
const FEATURES = [
  {
    icon: <ReportProblemOutlinedIcon />,
    color: severityColors.critical,
    title: "Incidents & ticketing",
    detail:
      "Full state-machine lifecycle — assignment, transitions, SLA timers and comments, enforced server-side at every step.",
  },
  {
    icon: <DnsOutlinedIcon />,
    color: theme.palette.primary.main,
    title: "CMDB",
    detail:
      "Every configuration item, rack and relationship in one registry, with lifecycle and criticality tracked centrally.",
  },
  {
    icon: <NotificationsActiveOutlinedIcon />,
    color: severityColors.warning,
    title: "Alerts & monitoring",
    detail:
      "Normalized signals from Redfish, SNMP, Zabbix and Prometheus — deduplicated and correlated to open tickets.",
  },
  {
    icon: <ScheduleOutlinedIcon />,
    color: severityColors.maintenance,
    title: "SLA & escalations",
    detail:
      "Policy-driven timers and escalation thresholds — configured in the database, never hard-coded into a release.",
  },
  {
    icon: <VerifiedUserOutlinedIcon />,
    color: severityColors.healthy,
    title: "Governance",
    detail:
      "Changes, problems, knowledge and risk/BCP records — with approval workflows and real separation of duties.",
  },
  {
    icon: <HistoryOutlinedIcon />,
    color: severityColors.unknown,
    title: "Audit trail",
    detail:
      "An append-only record of every state change, assignment and admin action — nothing edited after the fact.",
  },
];

const CONTACT_ROWS = [
  {
    icon: <MailOutlineIcon fontSize="small" />,
    label: "General enquiries",
    value: "ops@jsan-cts.example",
  },
  {
    icon: <GroupOutlinedIcon fontSize="small" />,
    label: "Access requests",
    value: "Talk to your site's Delivery / Operations Manager",
  },
  {
    icon: <SecurityOutlinedIcon fontSize="small" />,
    label: "Security & incidents",
    value: "security@jsan-cts.example",
  },
];

const bob = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-7px); }
`;

/** `on="dark"` (the brand panel) gets the white logo lockup; `on="light"`
 *  (the mobile compact header, on the page's light background) gets the
 *  full-color one — same two PNGs the internal sidebar and client portal
 *  header use, so the mark is identical everywhere it appears. */
function BrandMark({ height = 24, on = "dark" }: { height?: number; on?: "dark" | "light" }) {
  return (
    <Box
      component="img"
      src={on === "dark" ? "/jsan-logo-white.png" : "/jsan-logo.png"}
      alt="JSAN "
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

  // Contact form is decorative — same honesty rule as the social buttons:
  // nothing on a real page should look functional and silently do nothing.
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const submitContact = (e: FormEvent) => {
    e.preventDefault();
    setSnackbar("Thanks — this demo doesn't send anywhere yet.");
    setContactName("");
    setContactEmail("");
    setContactMessage("");
  };

  const scrollToHero = () => {
    document.getElementById("hero")?.scrollIntoView({ behavior: "smooth" });
  };

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
    <Box sx={{ bgcolor: "#f5f7fa" }}>
      {/* Nav — this page is the whole site for a signed-out visitor, so it
          carries its own header/footer rather than living inside App.tsx's
          authenticated shell (which /login deliberately renders outside of). */}
      <Box
        component="header"
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          bgcolor: alpha("#f5f7fa", 0.9),
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ maxWidth: 1180, mx: "auto", px: { xs: 2, sm: 3 }, py: 1.5 }}
        >
          <Stack direction="row" spacing={1.25} alignItems="center">
            <BrandMark height={20} on="light" />
            <Typography
              sx={{
                display: { xs: "none", sm: "block" },
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.04em",
                color: "text.secondary",
                borderLeft: "1px solid",
                borderColor: "divider",
                pl: 1.25,
              }}
            >
              CTS Data Center OpsDesk
            </Typography>
          </Stack>
          <Stack direction="row" spacing={3} alignItems="center">
            <Typography
              component="a"
              href="#how"
              sx={{
                display: { xs: "none", sm: "block" },
                fontSize: 13.5,
                fontWeight: 500,
                color: "text.secondary",
                textDecoration: "none",
                "&:hover": { color: "text.primary" },
              }}
            >
              How it works
            </Typography>
            <Typography
              component="a"
              href="#features"
              sx={{
                display: { xs: "none", sm: "block" },
                fontSize: 13.5,
                fontWeight: 500,
                color: "text.secondary",
                textDecoration: "none",
                "&:hover": { color: "text.primary" },
              }}
            >
              Features
            </Typography>
            <Typography
              component="a"
              href="#contact"
              sx={{
                display: { xs: "none", sm: "block" },
                fontSize: 13.5,
                fontWeight: 500,
                color: "text.secondary",
                textDecoration: "none",
                "&:hover": { color: "text.primary" },
              }}
            >
              Contact
            </Typography>
            <Button
              size="small"
              onClick={scrollToHero}
              sx={{
                textTransform: "none",
                fontWeight: 600,
                borderRadius: 2,
                bgcolor: theme.palette.primary.main,
                color: "#fff",
                px: 2,
                "&:hover": { bgcolor: theme.palette.secondary.main },
              }}
            >
              Sign in
            </Button>
          </Stack>
        </Stack>
      </Box>

      <Box
        id="hero"
        sx={{
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          alignItems: "center",
          gap: { xs: 6, md: 8 },
          maxWidth: 1180,
          mx: "auto",
          px: { xs: 2, sm: 3 },
          py: { xs: 6, md: 11 },
        }}
      >
        {/* Text column — desktop/tablet only; mobile gets a compact header instead. */}
        <Box sx={{ display: { xs: "none", md: "block" }, flex: "1 1 0", maxWidth: 540 }}>
          <Box
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 1,
              px: 1.75,
              py: 0.7,
              borderRadius: 5,
              bgcolor: alpha(theme.palette.primary.main, 0.06),
              border: "1px solid",
              borderColor: alpha(theme.palette.primary.main, 0.16),
            }}
          >
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                bgcolor: theme.palette.secondary.main,
                flexShrink: 0,
              }}
            />
            <Typography
              sx={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: theme.palette.primary.main,
              }}
            >
              CTS DATA CENTER OPSDESK
            </Typography>
          </Box>

          <Typography
            variant="h3"
            sx={{ fontWeight: 800, mt: 3, mb: 2, lineHeight: 1.15, letterSpacing: "-0.01em" }}
          >
            One console for{" "}
            <Box component="span" sx={{ color: theme.palette.secondary.main }}>
              the floor and the desk.
            </Box>
          </Typography>
          <Typography color="text.secondary" sx={{ fontSize: 16, mb: 4, maxWidth: 460 }}>
            Ticketing, CMDB, monitoring and governance for CTS/JSAN data-center operations —
            backend-enforced access, every change audited.
          </Typography>

          <Stack spacing={1.75}>
            {CAPABILITIES.map((cap) => (
              <Stack key={cap.label} direction="row" spacing={1.25} alignItems="center">
                <CheckCircleOutlinedIcon
                  sx={{ fontSize: 20, color: theme.palette.secondary.main, flexShrink: 0 }}
                />
                <Typography sx={{ fontSize: 14.5, fontWeight: 500 }}>{cap.detail}</Typography>
              </Stack>
            ))}
          </Stack>

          <Typography sx={{ mt: 4, fontSize: 12, color: "text.disabled" }}>
            Local/dev environment — real SSO lands in a later sprint.
          </Typography>
        </Box>

        {/* Sign-in card */}
        <Box
          sx={{
            width: "100%",
            flex: { md: "0 1 420px" },
            display: "flex",
            justifyContent: "center",
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
                  id="dev-login-user"
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

      {/* How it works */}
      <Box
        component="section"
        id="how"
        sx={{ maxWidth: 1180, mx: "auto", px: { xs: 2, sm: 3 }, py: { xs: 7, md: 9 } }}
      >
        <Box sx={{ maxWidth: 620, mb: 4.5 }}>
          <Typography
            sx={{
              color: theme.palette.secondary.dark,
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: "0.08em",
              mb: 1.25,
            }}
          >
            THE FLOW
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1.25 }}>
            How OpsDesk actually works
          </Typography>
          <Typography color="text.secondary">
            Four steps from "someone signs in" to "there's a record of what happened" — the same
            sequence whether it's a rack engineer on the floor or Service Desk at 2am.
          </Typography>
        </Box>

        <Grid container spacing={2.5}>
          {HOW_IT_WORKS.map((step, i) => (
            <Grid item xs={12} sm={6} md={3} key={step.title}>
              <Card
                elevation={0}
                sx={{
                  height: "100%",
                  p: 2.5,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 3,
                  boxShadow: "0 14px 30px -22px rgba(15, 61, 99, 0.35)",
                  animation: `${bob} 6.5s ease-in-out infinite`,
                  animationDelay: `${i * 0.5}s`,
                  transition: "box-shadow 0.25s ease",
                  "&:hover": {
                    animationPlayState: "paused",
                    boxShadow: "0 22px 38px -20px rgba(15, 61, 99, 0.45)",
                  },
                  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                }}
              >
                <Box
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    bgcolor: alpha(theme.palette.secondary.main, 0.1),
                    color: theme.palette.secondary.main,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12.5,
                    fontWeight: 700,
                    mb: 1.5,
                  }}
                >
                  {i + 1}
                </Box>
                <Typography sx={{ fontWeight: 700, fontSize: 14.5, mb: 0.75 }}>
                  {step.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.55 }}>
                  {step.detail}
                </Typography>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* Features */}
      <Box
        component="section"
        id="features"
        sx={{ maxWidth: 1180, mx: "auto", px: { xs: 2, sm: 3 }, py: { xs: 3, md: 4 } }}
      >
        <Box sx={{ maxWidth: 620, mb: 4.5 }}>
          <Typography
            sx={{
              color: theme.palette.secondary.dark,
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: "0.08em",
              mb: 1.25,
            }}
          >
            PLATFORM
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1.25 }}>
            Everything the floor and the desk need
          </Typography>
          <Typography color="text.secondary">
            One modular platform, strongly separated ownership per module — no module reaches into
            another's data.
          </Typography>
        </Box>

        <Grid container spacing={2.5}>
          {FEATURES.map((feature) => (
            <Grid item xs={12} sm={6} md={4} key={feature.title}>
              <Card
                elevation={0}
                sx={{
                  height: "100%",
                  p: 2.75,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 3,
                  transition: "transform 0.2s ease, box-shadow 0.2s ease",
                  "&:hover": {
                    transform: "translateY(-3px)",
                    boxShadow: "0 18px 34px -22px rgba(15, 61, 99, 0.35)",
                  },
                }}
              >
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 2,
                    bgcolor: alpha(feature.color, 0.1),
                    color: feature.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    mb: 1.75,
                  }}
                >
                  {feature.icon}
                </Box>
                <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 0.75 }}>
                  {feature.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.55 }}>
                  {feature.detail}
                </Typography>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* Contact */}
      <Box
        component="section"
        id="contact"
        sx={{ maxWidth: 1180, mx: "auto", px: { xs: 2, sm: 3 }, py: { xs: 5, md: 7 } }}
      >
        <Box
          sx={{
            bgcolor: PANEL_BG,
            backgroundImage: `radial-gradient(circle at 85% 15%, ${alpha(ACCENT, 0.18)}, transparent 50%)`,
            color: "#fff",
            borderRadius: 4,
            p: { xs: 3, sm: 5 },
          }}
        >
          <Grid container spacing={5}>
            <Grid item xs={12} md={6}>
              <Typography variant="h4" sx={{ fontWeight: 700, mb: 1.5 }}>
                Talk to the team
              </Typography>
              <Typography sx={{ color: alpha("#ffffff", 0.65), maxWidth: 400, mb: 3 }}>
                Access is granted per role and site — reach out and we'll get you scoped correctly
                the first time.
              </Typography>
              <Stack spacing={2}>
                {CONTACT_ROWS.map((row) => (
                  <Stack key={row.label} direction="row" spacing={1.75} alignItems="flex-start">
                    <Box
                      sx={{
                        width: 30,
                        height: 30,
                        borderRadius: "8px",
                        bgcolor: alpha("#ffffff", 0.08),
                        color: ACCENT,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {row.icon}
                    </Box>
                    <Box>
                      <Typography sx={{ fontWeight: 600, fontSize: 13 }}>{row.label}</Typography>
                      <Typography sx={{ color: alpha("#ffffff", 0.55), fontSize: 12.5 }}>
                        {row.value}
                      </Typography>
                    </Box>
                  </Stack>
                ))}
              </Stack>
            </Grid>

            <Grid item xs={12} md={6}>
              <Box
                component="form"
                onSubmit={submitContact}
                sx={{
                  bgcolor: alpha("#ffffff", 0.04),
                  border: "1px solid",
                  borderColor: alpha("#ffffff", 0.1),
                  borderRadius: 3,
                  p: 2.5,
                }}
              >
                <Stack spacing={1.75}>
                  <TextField
                    id="contact-name"
                    label="Name"
                    size="small"
                    required
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    InputLabelProps={{ sx: { color: alpha("#ffffff", 0.6) } }}
                    sx={{
                      "& .MuiOutlinedInput-root": {
                        color: "#fff",
                        bgcolor: alpha("#ffffff", 0.05),
                        borderRadius: 1.5,
                        "& fieldset": { borderColor: alpha("#ffffff", 0.18) },
                      },
                    }}
                  />
                  <TextField
                    id="contact-email"
                    type="email"
                    label="Email"
                    size="small"
                    required
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    InputLabelProps={{ sx: { color: alpha("#ffffff", 0.6) } }}
                    sx={{
                      "& .MuiOutlinedInput-root": {
                        color: "#fff",
                        bgcolor: alpha("#ffffff", 0.05),
                        borderRadius: 1.5,
                        "& fieldset": { borderColor: alpha("#ffffff", 0.18) },
                      },
                    }}
                  />
                  <TextField
                    id="contact-message"
                    label="Message"
                    size="small"
                    required
                    multiline
                    minRows={3}
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                    placeholder="Which site, and what you need access to..."
                    InputLabelProps={{ sx: { color: alpha("#ffffff", 0.6) } }}
                    sx={{
                      "& .MuiOutlinedInput-root": {
                        color: "#fff",
                        bgcolor: alpha("#ffffff", 0.05),
                        borderRadius: 1.5,
                        "& fieldset": { borderColor: alpha("#ffffff", 0.18) },
                      },
                    }}
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    sx={{
                      bgcolor: "#fff",
                      color: PANEL_BG,
                      fontWeight: 700,
                      textTransform: "none",
                      borderRadius: 2,
                      boxShadow: "none",
                      "&:hover": { bgcolor: ACCENT, color: "#fff" },
                    }}
                  >
                    Send message
                  </Button>
                </Stack>
              </Box>
            </Grid>
          </Grid>
        </Box>
      </Box>

      {/* Footer */}
      <Box
        component="footer"
        sx={{
          maxWidth: 1180,
          mx: "auto",
          px: { xs: 2, sm: 3 },
          py: 4,
          borderTop: "1px solid",
          borderColor: "divider",
        }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          alignItems={{ xs: "flex-start", sm: "center" }}
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <BrandMark height={17} on="light" />
            <Typography sx={{ fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.04em",
                color: "text.secondary",
                borderLeft: "1px solid",
                borderColor: "divider",
                pl: 1.25, }}>
              CTS Data Center OpsDesk
            </Typography>
          </Stack>
          <Typography sx={{ fontSize: 11.5, color: "text.secondary", maxWidth: 420 }}>
            Local/dev environment — real SSO lands in a later sprint. The contact form above is
            illustrative and doesn't send anywhere yet.
          </Typography>
        </Stack>
      </Box>

      <Snackbar
        open={snackbar !== null}
        autoHideDuration={3200}
        onClose={() => setSnackbar(null)}
        message={snackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
