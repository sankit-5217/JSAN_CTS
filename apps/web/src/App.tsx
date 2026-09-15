import { useState, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, Link, useLocation } from "react-router-dom";
import {
  AppBar,
  Avatar,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, darken } from "@mui/material/styles";
import ApartmentOutlinedIcon from "@mui/icons-material/ApartmentOutlined";
import BugReportOutlinedIcon from "@mui/icons-material/BugReportOutlined";
import ChangeCircleOutlinedIcon from "@mui/icons-material/ChangeCircleOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import GppMaybeOutlinedIcon from "@mui/icons-material/GppMaybeOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import NotificationsActiveOutlinedIcon from "@mui/icons-material/NotificationsActiveOutlined";
import PolicyOutlinedIcon from "@mui/icons-material/PolicyOutlined";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import { clearStoredToken, getStoredToken } from "./api/client";
import { decodeJwtPayload, getCurrentUserRole } from "./api/jwt";
import { theme } from "./theme/theme";
import { ClientLayout } from "./pages/client/ClientLayout";
import { MyTicketsPage } from "./pages/client/MyTicketsPage";
import { ReportIssuePage } from "./pages/client/ReportIssuePage";
import { TicketDetailPage } from "./pages/client/TicketDetailPage";
import { AlertDetailPage } from "./pages/AlertDetailPage";
import { AlertRulesPage } from "./pages/AlertRulesPage";
import { AlertsPage } from "./pages/AlertsPage";
import { BcpPlanDetailPage } from "./pages/BcpPlanDetailPage";
import { BcpPlansPage } from "./pages/BcpPlansPage";
import { ChangeDetailPage } from "./pages/ChangeDetailPage";
import { ChangesPage } from "./pages/ChangesPage";
import { CiDetailPage } from "./pages/CiDetailPage";
import { CisPage } from "./pages/CisPage";
import { CommandCenterPage } from "./pages/CommandCenterPage";
import { IncidentDetailPage } from "./pages/IncidentDetailPage";
import { IncidentsPage } from "./pages/IncidentsPage";
import { KnowledgeDetailPage } from "./pages/KnowledgeDetailPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { LoginPage } from "./pages/LoginPage";
import { ProblemDetailPage } from "./pages/ProblemDetailPage";
import { ProblemsPage } from "./pages/ProblemsPage";
import { RiskDetailPage } from "./pages/RiskDetailPage";
import { RisksPage } from "./pages/RisksPage";
import { SiteDetailPage } from "./pages/SiteDetailPage";
import { SitesPage } from "./pages/SitesPage";
import { SlaPoliciesPage } from "./pages/SlaPoliciesPage";
import { SupportGroupsPage } from "./pages/SupportGroupsPage";
import { VendorCaseDetailPage } from "./pages/VendorCaseDetailPage";
import { VendorsPage } from "./pages/VendorsPage";

const DRAWER_WIDTH = 248;

// Derived from the app's own primary/secondary tokens (theme/theme.ts) rather
// than fresh hex literals, so the sidebar stays in the same palette family if
// the brand color ever changes.
const SIDEBAR_BG = darken(theme.palette.primary.main, 0.45);
const SIDEBAR_BORDER = alpha("#ffffff", 0.08);
const SIDEBAR_TEXT = alpha("#ffffff", 0.72);
const SIDEBAR_TEXT_MUTED = alpha("#ffffff", 0.45);
const SIDEBAR_HOVER_BG = alpha("#ffffff", 0.06);
const ACCENT = theme.palette.secondary.light;
const ACCENT_BG = alpha(ACCENT, 0.16);
const ACCENT_HOVER_BG = alpha(ACCENT, 0.24);

// Role identity colors — deliberately outside the severity palette
// (severityColors in theme/theme.ts: green/orange/red/blue-maintenance) so a
// role badge never reads as a health status. One entry per UserRole (spec
// §5's 8 roles); ROLE_META falls back to a neutral slate for anything else.
const ROLE_META: Record<string, { label: string; color: string }> = {
  SUPER_ADMIN: { label: "Super Admin", color: "#0f3d63" },
  SERVICE_DESK_NOC: { label: "Service Desk / NOC", color: "#1565c0" },
  SITE_ENGINEER: { label: "Site Engineer", color: "#2f8f83" },
  INFRASTRUCTURE_LEAD: { label: "Infrastructure Lead", color: "#5c6bc0" },
  VENDOR_COORDINATOR: { label: "Vendor Coordinator", color: "#8e5b9f" },
  DELIVERY_OPS_MANAGER: { label: "Delivery Ops Manager", color: "#536da7" },
  CTS_MANAGER_VIEWER: { label: "CTS Manager (Viewer)", color: "#6b7c93" },
  AUDITOR_READ_ONLY: { label: "Auditor (Read Only)", color: "#5c5f66" },
};

function roleMeta(role: string): { label: string; color: string } {
  return ROLE_META[role] ?? { label: role, color: "#5c5f66" };
}

interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// Grouped by module ownership (CLAUDE.md's Dev A/Dev B split) so a user
// finds a page where the system's own mental model puts it, not in one
// long undifferentiated list — the "Command Grid" layout direction.
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Ticketing core",
    items: [
      { label: "Command Center", to: "/", icon: <DashboardOutlinedIcon fontSize="small" /> },
      {
        label: "Incidents",
        to: "/incidents",
        icon: <ReportProblemOutlinedIcon fontSize="small" />,
      },
      { label: "CMDB", to: "/cis", icon: <DnsOutlinedIcon fontSize="small" /> },
      { label: "Sites", to: "/sites", icon: <ApartmentOutlinedIcon fontSize="small" /> },
      {
        label: "SLA policies",
        to: "/sla-policies",
        icon: <ScheduleOutlinedIcon fontSize="small" />,
      },
      {
        label: "Support groups",
        to: "/support-groups",
        icon: <GroupsOutlinedIcon fontSize="small" />,
      },
    ],
  },
  {
    label: "Monitoring",
    items: [
      {
        label: "Alerts",
        to: "/alerts",
        icon: <NotificationsActiveOutlinedIcon fontSize="small" />,
      },
      { label: "Alert rules", to: "/alert-rules", icon: <TuneOutlinedIcon fontSize="small" /> },
    ],
  },
  {
    label: "Governance",
    items: [
      { label: "Changes", to: "/changes", icon: <ChangeCircleOutlinedIcon fontSize="small" /> },
      { label: "Problems", to: "/problems", icon: <BugReportOutlinedIcon fontSize="small" /> },
      { label: "Vendors", to: "/vendors", icon: <LocalShippingOutlinedIcon fontSize="small" /> },
      { label: "Knowledge", to: "/knowledge", icon: <MenuBookOutlinedIcon fontSize="small" /> },
      { label: "Risks", to: "/risks", icon: <GppMaybeOutlinedIcon fontSize="small" /> },
      { label: "BCP plans", to: "/bcp-plans", icon: <PolicyOutlinedIcon fontSize="small" /> },
    ],
  },
];

/** Exact match for "/" (else every route would highlight it too); prefix match otherwise. */
function isActive(pathname: string, to: string): boolean {
  return to === "/" ? pathname === "/" : pathname.startsWith(to);
}

/** Shared between the permanent (desktop) and temporary (mobile overlay) drawers. */
function SidebarContent({ onNavigate }: { onNavigate: () => void }) {
  const location = useLocation();
  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Toolbar sx={{ px: 2.5, py: 2.5, minHeight: "76px !important" }}>
        <Stack spacing={1}>
          <Box
            component="img"
            src="/jsan-logo-white.png"
            alt="JSAN"
            sx={{ height: 30, width: "auto", display: "block" }}
          />
          <Typography
            sx={{
              color: SIDEBAR_TEXT_MUTED,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
            }}
          >
            CTS &middot; DATA CENTER OPSDESK
          </Typography>
        </Stack>
      </Toolbar>
      <Divider sx={{ borderColor: SIDEBAR_BORDER }} />
      <Box sx={{ flex: 1, overflowY: "auto", py: 1.5 }}>
        {NAV_GROUPS.map((group, groupIndex) => (
          <Box key={group.label}>
            {groupIndex > 0 && (
              <Divider sx={{ my: 1.5, mx: 2, borderColor: alpha("#ffffff", 0.06) }} />
            )}
            <List
              dense
              disablePadding
              subheader={
                <ListSubheader
                  component="div"
                  sx={{
                    bgcolor: "transparent",
                    color: SIDEBAR_TEXT_MUTED,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    lineHeight: "30px",
                    px: 2.5,
                  }}
                >
                  {group.label}
                </ListSubheader>
              }
            >
              {group.items.map((item) => {
                const active = isActive(location.pathname, item.to);
                return (
                  <ListItemButton
                    key={item.to}
                    component={Link}
                    to={item.to}
                    selected={active}
                    onClick={onNavigate}
                    sx={{
                      mx: 1,
                      mb: 0.25,
                      px: 1.5,
                      py: 0.75,
                      borderRadius: 1.5,
                      color: active ? "#fff" : SIDEBAR_TEXT,
                      bgcolor: active ? ACCENT_BG : "transparent",
                      borderLeft: active ? `3px solid ${ACCENT}` : "3px solid transparent",
                      transition: "background-color 120ms ease, color 120ms ease",
                      "&:hover": {
                        bgcolor: active ? ACCENT_HOVER_BG : SIDEBAR_HOVER_BG,
                      },
                      "&.Mui-selected": { bgcolor: ACCENT_BG },
                      "&.Mui-selected:hover": { bgcolor: ACCENT_HOVER_BG },
                    }}
                  >
                    <ListItemIcon
                      sx={{ minWidth: 34, color: active ? ACCENT : alpha("#ffffff", 0.55) }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        fontSize: 13.5,
                        fontWeight: active ? 600 : 500,
                      }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/**
 * Permanent on tablet/desktop; a swipeable overlay on phone-width viewports
 * (MUI breakpoint helper docs recommend `sm` as the phone/tablet cutoff).
 * Both drawers render the same `SidebarContent` so nav structure/styling
 * never drifts between the two.
 */
function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const paperSx = {
    width: DRAWER_WIDTH,
    boxSizing: "border-box" as const,
    bgcolor: SIDEBAR_BG,
    borderRight: `1px solid ${SIDEBAR_BORDER}`,
    backgroundImage: "none",
  };
  return (
    <>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onClose}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: "block", sm: "none" }, "& .MuiDrawer-paper": paperSx }}
      >
        <SidebarContent onNavigate={onClose} />
      </Drawer>
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: "none", sm: "block" },
          width: DRAWER_WIDTH,
          flexShrink: 0,
          "& .MuiDrawer-paper": paperSx,
        }}
      >
        <SidebarContent onNavigate={() => undefined} />
      </Drawer>
    </>
  );
}

/** Initials for the avatar — no display-name field on the JWT, so this reads
 * from the email local-part (e.g. "priya.singh@..." -> "PS", "admin@..." -> "A"). */
function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[.\-_]+/).filter(Boolean);
  const chars = parts.length >= 2 ? [parts[0][0], parts[1][0]] : [local.slice(0, 2)];
  return chars.join("").toUpperCase();
}

/** Slim top bar: an interactive identity menu (avatar + role, click for
 * account details and logout) plus the mobile nav toggle. */
function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const token = getStoredToken();
  const user = token ? decodeJwtPayload(token) : null;
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const menuOpen = Boolean(anchorEl);
  const meta = user ? roleMeta(user.role) : null;

  const handleLogout = () => {
    clearStoredToken();
    window.location.assign("/login");
  };

  return (
    <AppBar
      position="static"
      color="default"
      elevation={0}
      sx={{ borderBottom: 1, borderColor: "divider" }}
    >
      <Toolbar sx={{ gap: 1.5, minHeight: "76px !important" }}>
        <IconButton
          onClick={onMenuClick}
          edge="start"
          aria-label="Open navigation menu"
          sx={{ display: { xs: "inline-flex", sm: "none" } }}
        >
          <MenuOutlinedIcon />
        </IconButton>
        <Box sx={{ flex: 1 }} />
        {user && meta && (
          <>
            <Tooltip title="Account">
              <Stack
                component="button"
                type="button"
                onClick={(e) => setAnchorEl(e.currentTarget)}
                aria-label="Open account menu"
                aria-haspopup="true"
                aria-expanded={menuOpen}
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  border: "1px solid",
                  borderColor: alpha(meta.color, 0.28),
                  borderRadius: 999,
                  pl: 0.5,
                  pr: 1.25,
                  py: 0.5,
                  bgcolor: menuOpen ? alpha(meta.color, 0.14) : alpha(meta.color, 0.07),
                  cursor: "pointer",
                  font: "inherit",
                  transition: "background-color 150ms ease, box-shadow 150ms ease",
                  "&:hover": { bgcolor: alpha(meta.color, 0.14) },
                  "&:focus-visible": { boxShadow: `0 0 0 3px ${alpha(meta.color, 0.3)}` },
                }}
              >
                <Avatar
                  sx={{
                    width: 30,
                    height: 30,
                    bgcolor: meta.color,
                    fontSize: 12.5,
                    fontWeight: 700,
                  }}
                >
                  {initialsFromEmail(user.email)}
                </Avatar>
                <Box sx={{ display: { xs: "none", sm: "block" }, textAlign: "left", minWidth: 0 }}>
                  <Typography
                    sx={{ fontSize: 12.5, fontWeight: 700, color: meta.color, lineHeight: 1.2 }}
                  >
                    {meta.label}
                  </Typography>
                  <Typography
                    noWrap
                    sx={{ fontSize: 11.5, color: "text.secondary", lineHeight: 1.3, maxWidth: 180 }}
                  >
                    {user.email}
                  </Typography>
                </Box>
                <ExpandMoreOutlinedIcon
                  fontSize="small"
                  sx={{
                    color: meta.color,
                    transition: "transform 150ms ease",
                    transform: menuOpen ? "rotate(180deg)" : "none",
                  }}
                />
              </Stack>
            </Tooltip>
            <Menu
              anchorEl={anchorEl}
              open={menuOpen}
              onClose={() => setAnchorEl(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
              transformOrigin={{ vertical: "top", horizontal: "right" }}
              slotProps={{ paper: { sx: { minWidth: 240, mt: 1 } } }}
            >
              <Box sx={{ px: 2, py: 1.25, display: { xs: "block", sm: "none" } }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: meta.color }}>
                  {meta.label}
                </Typography>
                <Typography noWrap sx={{ fontSize: 12, color: "text.secondary" }}>
                  {user.email}
                </Typography>
              </Box>
              <Divider sx={{ display: { xs: "block", sm: "none" } }} />
              <MenuItem onClick={handleLogout} sx={{ color: "error.main", gap: 1 }}>
                <LogoutOutlinedIcon fontSize="small" />
                Log out
              </MenuItem>
            </Menu>
          </>
        )}
      </Toolbar>
    </AppBar>
  );
}

/** Every route under here requires a stored token — sends unauthenticated
 * visits to sign in first instead of letting every page 401 individually. */
function AuthenticatedLayout() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  if (!getStoredToken()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  // The client role gets a purpose-built portal (ClientLayout), not the
  // internal ops console — none of the fourteen modules below are theirs.
  if (getCurrentUserRole() === "CTS_MANAGER_VIEWER") {
    return <Navigate to="/client/report" replace />;
  }
  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar onMenuClick={() => setMobileOpen(true)} />
        <Box component="main" sx={{ flex: 1, p: { xs: 2, sm: 3 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ClientLayout />}>
        <Route path="/client/report" element={<ReportIssuePage />} />
        <Route path="/client/tickets" element={<MyTicketsPage />} />
        <Route path="/client/tickets/:id" element={<TicketDetailPage />} />
      </Route>
      <Route element={<AuthenticatedLayout />}>
        <Route path="/" element={<CommandCenterPage />} />
        <Route path="/sites" element={<SitesPage />} />
        <Route path="/sites/:id" element={<SiteDetailPage />} />
        <Route path="/cis" element={<CisPage />} />
        <Route path="/cis/:id" element={<CiDetailPage />} />
        <Route path="/incidents" element={<IncidentsPage />} />
        <Route path="/incidents/:id" element={<IncidentDetailPage />} />
        <Route path="/sla-policies" element={<SlaPoliciesPage />} />
        <Route path="/support-groups" element={<SupportGroupsPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/alerts/:id" element={<AlertDetailPage />} />
        <Route path="/alert-rules" element={<AlertRulesPage />} />
        <Route path="/changes" element={<ChangesPage />} />
        <Route path="/changes/:id" element={<ChangeDetailPage />} />
        <Route path="/vendors" element={<VendorsPage />} />
        <Route path="/vendor-cases/:id" element={<VendorCaseDetailPage />} />
        <Route path="/problems" element={<ProblemsPage />} />
        <Route path="/problems/:id" element={<ProblemDetailPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/knowledge/:id" element={<KnowledgeDetailPage />} />
        <Route path="/risks" element={<RisksPage />} />
        <Route path="/risks/:id" element={<RiskDetailPage />} />
        <Route path="/bcp-plans" element={<BcpPlansPage />} />
        <Route path="/bcp-plans/:id" element={<BcpPlanDetailPage />} />
      </Route>
    </Routes>
  );
}
