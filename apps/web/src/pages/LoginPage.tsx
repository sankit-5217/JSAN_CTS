import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  InputAdornment,
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
import SearchIcon from "@mui/icons-material/Search";
import SecurityOutlinedIcon from "@mui/icons-material/SecurityOutlined";
import VerifiedUserOutlinedIcon from "@mui/icons-material/VerifiedUserOutlined";
import { apiGet, apiPost, SSO_LOGIN_URL, storeToken } from "../api/client";
import { decodeJwtPayload } from "../api/jwt";
import { severityColors, theme } from "../theme/theme";

interface DevLoginResponse {
  accessToken: string;
}

/** GET /auth/providers — which sign-in paths this environment offers. */
interface AuthProviders {
  sso: { enabled: boolean; label: string };
  devLogin: boolean;
}

// Reasons the API's OIDC callback can bounce back with (`?sso_error=`).
const SSO_ERROR_MESSAGES: Record<string, string> = {
  not_provisioned:
    "Your account isn't set up in OpsDesk yet. Ask an OpsDesk administrator to add you.",
  inactive: "Your OpsDesk account is deactivated. Contact an OpsDesk administrator.",
  identity_mismatch:
    "This email is already linked to a different SSO account. Contact an OpsDesk administrator.",
  email_missing: "Your identity provider didn't share an email address, so we can't match you.",
  email_unverified: "Your email address isn't verified with your identity provider.",
  idp_error: "Sign-in was cancelled or refused by your identity provider.",
  invalid_state: "Your sign-in session expired. Please try again.",
  idp_unavailable: "The identity provider is unreachable right now. Please try again shortly.",
  sso_disabled: "SSO isn't configured for this environment.",
  login_failed: "SSO sign-in failed. Please try again.",
};

// Same dark-navy-derived-from-primary palette as the app shell's sidebar
// (App.tsx) — each page derives its own tokens from theme/theme.ts rather
// than importing another page's private constants (CommandCenterPage's
// HEALTH_COLOR follows the same pattern).
const PANEL_BG = darken(theme.palette.primary.main, 0.45);
const ACCENT = theme.palette.secondary.light;

// Matches apps/api/prisma/seed.ts's seeded users — search suggestions for the
// email box, not a hard-coded allowlist (any active user's email works via
// dev-login, typed in full). There's deliberately no API call here: a
// signed-out page must not be able to list the organization's users.
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
    email: "engineer2@example.com",
    role: "SITE_ENGINEER",
    scope: "SITE01",
    note: "Hands-on floor engineering and hardware actions.",
  },
  {
    email: "rahul@example.com",
    role: "SITE_ENGINEER",
    scope: "SITE01",
    note: "Routing demo: Windows + Servers skills, Windows & Servers team.",
  },
  {
    email: "vikas@example.com",
    role: "SITE_ENGINEER",
    scope: "SITE01",
    note: "Routing demo: Storage + Backup skills, Storage & Backup team.",
  },
  {
    email: "engineer@example.com",
    role: "SITE_ENGINEER",
    scope: "SITE02",
    note: "Hands-on floor engineering and hardware actions.",
  },
  {
    email: "viewer@example.com",
    role: "CLIENT_MANAGER_VIEWER",
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
    value: "ops@jsan.example",
  },
  {
    icon: <GroupOutlinedIcon fontSize="small" />,
    label: "Access requests",
    value: "Talk to your site's Delivery / Operations Manager",
  },
  {
    icon: <SecurityOutlinedIcon fontSize="small" />,
    label: "Security & incidents",
    value: "security@jsan.example",
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
 * Sign-in page. Primary path is SSO (a full-page hop through the API's
 * OIDC login, back via SsoCallbackPage); `POST /auth/dev-login` is only
 * offered where the API reports it enabled (never in production).
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const ssoError = searchParams.get("sso_error");
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const typedEmail = email.trim().toLowerCase();
  const selectedUser = SEEDED_USERS.find((u) => u.email === typedEmail);

  // Contact form is decorative — nothing on a real page should look
  // functional and silently do nothing.
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

  useEffect(() => {
    apiGet<AuthProviders>("/auth/providers")
      .then(setProviders)
      // API unreachable: offer nothing clickable rather than guessing.
      .catch(() =>
        setProviders({ sso: { enabled: false, label: "Sign in with SSO" }, devLogin: false }),
      );
  }, []);

  const scrollToHero = () => {
    document.getElementById("hero")?.scrollIntoView({ behavior: "smooth" });
  };

  const handleLogin = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!typedEmail || loading) return;
    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await apiPost<DevLoginResponse>("/auth/dev-login", {
        email: typedEmail,
      });
      storeToken(accessToken, "dev");
      const role = decodeJwtPayload(accessToken)?.role;
      navigate(role === "CLIENT_MANAGER_VIEWER" ? "/client/report" : "/");
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
          zIndex: 12,
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
                fontSize: 14.5,
                fontWeight: 600,
                letterSpacing: "0.04em",
                color: "text.secondary",
                borderLeft: "1px solid",
                borderColor: "divider",
                pl: 1.25,
              }}
            >
              JSAN Data Center OpsDesk
            </Typography>
          </Stack>
          <Stack direction="row" spacing={3} alignItems="center">
            <Typography
              component="a"
              href="#how"
              sx={{
                display: { xs: "none", sm: "block" },
                fontSize: 14.5,
                fontWeight: 700,
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
                fontSize: 14.5,
                fontWeight: 700,
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
                fontSize: 14.5,
                fontWeight: 700,
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
                fontWeight: 700,
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
              JSAN DATA CENTER OPSDESK
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
            Ticketing, CMDB, monitoring and governance for JSAN data-center operations —
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
            Sign in with your organization's SSO account.
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
            <Stack
              direction="row"
              spacing={1.25}
              alignItems="center"
              sx={{ mb: 3, display: { xs: "flex", md: "none" } }}
            >
              <BrandMark height={38} on="light" />
              <Typography
                sx={{
                  color: "text.secondary",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  borderLeft: "1px solid",
                  borderColor: "divider",
                  pl: 1.25,
                }}
              >
                JSAN DATA CENTER OPSDESK
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
                  Sign in to JSAN OpsDesk
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                  Continue with your organization account.
                </Typography>

                {ssoError && (
                  <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                    {SSO_ERROR_MESSAGES[ssoError] ?? SSO_ERROR_MESSAGES.login_failed}
                  </Alert>
                )}

                {providers === null ? (
                  <Box sx={{ display: "flex", justifyContent: "center", py: 1.5, mb: 2.5 }}>
                    <CircularProgress size={22} />
                  </Box>
                ) : (
                  <Tooltip
                    title={
                      providers.sso.enabled ? "" : "SSO isn't configured for this environment."
                    }
                  >
                    <span>
                      <Button
                        fullWidth
                        variant="contained"
                        size="large"
                        disabled={!providers.sso.enabled}
                        startIcon={<VerifiedUserOutlinedIcon />}
                        // Full-page navigation: the API redirects on to the IdP.
                        href={SSO_LOGIN_URL}
                        sx={{
                          mb: 2.5,
                          borderRadius: 2,
                          py: 1.1,
                          textTransform: "none",
                          fontWeight: 600,
                          fontSize: 15,
                          boxShadow: "none",
                        }}
                      >
                        {providers.sso.label}
                      </Button>
                    </span>
                  </Tooltip>
                )}

                {providers?.devLogin && (
                  <>
                    <Divider sx={{ mb: 2.5, fontSize: 12, color: "text.secondary" }}>
                      or dev-mode sign-in
                    </Divider>

                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      Type or search a seeded work email, no password. Disabled server-side outside
                      local/dev.
                    </Typography>

                    {error && (
                      <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                        Sign-in failed: {error}
                      </Alert>
                    )}

                    <Box component="form" onSubmit={handleLogin} noValidate>
                      <Autocomplete
                        id="dev-login-user"
                        freeSolo
                        openOnFocus
                        options={SEEDED_USERS}
                        inputValue={email}
                        onInputChange={(_, value) => setEmail(value)}
                        onChange={(_, value) =>
                          setEmail(typeof value === "string" ? value : (value?.email ?? ""))
                        }
                        getOptionLabel={(user) => (typeof user === "string" ? user : user.email)}
                        filterOptions={(users, { inputValue }) => {
                          const q = inputValue.trim().toLowerCase();
                          return q
                            ? users.filter((u) =>
                                [u.email, u.role, u.scope, u.note].some((field) =>
                                  field.toLowerCase().includes(q),
                                ),
                              )
                            : users;
                        }}
                        renderOption={(props, user) => {
                          const { key, ...rest } = props as typeof props & { key: string };
                          return (
                            <Box component="li" key={key} {...rest}>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2" noWrap>
                                  {user.email}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {user.role} · {user.scope}
                                </Typography>
                              </Box>
                            </Box>
                          );
                        }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Work email"
                            placeholder="Search by email, role or site"
                            autoComplete="username"
                            InputProps={{
                              ...params.InputProps,
                              startAdornment: (
                                <InputAdornment position="start">
                                  <SearchIcon fontSize="small" />
                                </InputAdornment>
                              ),
                            }}
                          />
                        )}
                        noOptionsText="No demo user matches. Type a full work email to sign in."
                        sx={{ mb: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
                      />

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
                        type="submit"
                        variant="contained"
                        fullWidth
                        size="large"
                        disabled={loading || !typedEmail}
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
                    </Box>
                  </>
                )}
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
          <Stack direction="row" spacing={1.25} alignItems="center">
            <BrandMark height={20} on="light" />
            <Typography
              sx={{
                fontSize: 14.5,
                fontWeight: 700,
                letterSpacing: "0.04em",
                color: "text.secondary",
                borderLeft: "1px solid",
                borderColor: "divider",
                pl: 1.25,
              }}
            >
              JSAN Data Center OpsDesk
            </Typography>
          </Stack>
          <Typography sx={{ fontSize: 11.5, color: "text.secondary", maxWidth: 420 }}>
            The contact form above is illustrative and doesn't send anywhere yet.
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
