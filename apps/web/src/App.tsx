import { Navigate, Outlet, Route, Routes, Link, useLocation } from "react-router-dom";
import { AppBar, Box, Toolbar, Typography, Button } from "@mui/material";
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

function TopNav() {
  const token = getStoredToken();
  const user = token ? decodeJwtPayload(token) : null;

  return (
    <AppBar position="static">
      <Toolbar>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          JSAN CTS Data Center OpsDesk
        </Typography>
        <Button color="inherit" component={Link} to="/">
          Command Center
        </Button>
        <Button color="inherit" component={Link} to="/sites">
          Sites
        </Button>
        <Button color="inherit" component={Link} to="/cis">
          CMDB
        </Button>
        <Button color="inherit" component={Link} to="/incidents">
          Incidents
        </Button>
        <Button color="inherit" component={Link} to="/sla-policies">
          SLA Policies
        </Button>
        <Button color="inherit" component={Link} to="/alerts">
          Alerts
        </Button>
        <Button color="inherit" component={Link} to="/changes">
          Changes
        </Button>
        <Button color="inherit" component={Link} to="/vendors">
          Vendors
        </Button>
        <Button color="inherit" component={Link} to="/problems">
          Problems
        </Button>
        <Button color="inherit" component={Link} to="/knowledge">
          Knowledge
        </Button>
        <Button color="inherit" component={Link} to="/risks">
          Risks
        </Button>
        {user && (
          <Typography variant="body2" sx={{ mx: 2, opacity: 0.85 }}>
            {user.email} ({user.role})
          </Typography>
        )}
        {token && (
          <Button
            color="inherit"
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
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <TopNav />
      <Box component="main" sx={{ flex: 1, p: 3 }}>
        <Outlet />
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
