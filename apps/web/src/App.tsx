import { Navigate, Outlet, Route, Routes, Link, useLocation } from "react-router-dom";
import {
  AppBar,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Toolbar,
  Typography,
} from "@mui/material";
import { clearStoredToken, getStoredToken } from "./api/client";
import { decodeJwtPayload } from "./api/jwt";
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
import { VendorCaseDetailPage } from "./pages/VendorCaseDetailPage";
import { VendorsPage } from "./pages/VendorsPage";

const DRAWER_WIDTH = 232;

// Grouped by module ownership (CLAUDE.md's Dev A/Dev B split) so a user
// finds a page where the system's own mental model puts it, not in one
// long undifferentiated list — the "Command Grid" layout direction.
const NAV_GROUPS: { label: string; items: { label: string; to: string }[] }[] = [
  {
    label: "Ticketing core",
    items: [
      { label: "Command Center", to: "/" },
      { label: "Incidents", to: "/incidents" },
      { label: "CMDB", to: "/cis" },
      { label: "Sites", to: "/sites" },
      { label: "SLA policies", to: "/sla-policies" },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { label: "Alerts", to: "/alerts" },
      { label: "Alert rules", to: "/alert-rules" },
    ],
  },
  {
    label: "Governance",
    items: [
      { label: "Changes", to: "/changes" },
      { label: "Problems", to: "/problems" },
      { label: "Vendors", to: "/vendors" },
      { label: "Knowledge", to: "/knowledge" },
      { label: "Risks", to: "/risks" },
      { label: "BCP plans", to: "/bcp-plans" },
    ],
  },
];

/** Exact match for "/" (else every route would highlight it too); prefix match otherwise. */
function isActive(pathname: string, to: string): boolean {
  return to === "/" ? pathname === "/" : pathname.startsWith(to);
}

function Sidebar() {
  const location = useLocation();
  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" },
      }}
    >
      <Toolbar>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          OpsDesk
        </Typography>
      </Toolbar>
      <Divider />
      {NAV_GROUPS.map((group) => (
        <List
          key={group.label}
          dense
          subheader={
            <ListSubheader component="div" sx={{ lineHeight: "32px" }}>
              {group.label}
            </ListSubheader>
          }
        >
          {group.items.map((item) => (
            <ListItemButton
              key={item.to}
              component={Link}
              to={item.to}
              selected={isActive(location.pathname, item.to)}
            >
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
      ))}
    </Drawer>
  );
}

/** Slim top bar: identity + logout only — page navigation now lives in the sidebar. */
function TopBar() {
  const token = getStoredToken();
  const user = token ? decodeJwtPayload(token) : null;

  return (
    <AppBar
      position="static"
      color="default"
      elevation={0}
      sx={{ borderBottom: 1, borderColor: "divider" }}
    >
      <Toolbar sx={{ justifyContent: "flex-end", gap: 1.5 }}>
        {user && <Chip size="small" label={user.role} variant="outlined" />}
        {user && (
          <Typography variant="body2" color="text.secondary">
            {user.email}
          </Typography>
        )}
        {token && (
          <Button
            size="small"
            onClick={() => {
              clearStoredToken();
              window.location.assign("/login");
            }}
          >
            Log out
          </Button>
        )}
      </Toolbar>
    </AppBar>
  );
}

/** Every route under here requires a stored token — sends unauthenticated
 * visits to sign in first instead of letting every page 401 individually. */
function AuthenticatedLayout() {
  const location = useLocation();
  if (!getStoredToken()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar />
        <Box component="main" sx={{ flex: 1, p: 3 }}>
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
      <Route element={<AuthenticatedLayout />}>
        <Route path="/" element={<CommandCenterPage />} />
        <Route path="/sites" element={<SitesPage />} />
        <Route path="/sites/:id" element={<SiteDetailPage />} />
        <Route path="/cis" element={<CisPage />} />
        <Route path="/cis/:id" element={<CiDetailPage />} />
        <Route path="/incidents" element={<IncidentsPage />} />
        <Route path="/incidents/:id" element={<IncidentDetailPage />} />
        <Route path="/sla-policies" element={<SlaPoliciesPage />} />
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
