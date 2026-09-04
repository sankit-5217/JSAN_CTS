import { Navigate, Outlet, Route, Routes, Link, useLocation } from "react-router-dom";
import { AppBar, Box, Toolbar, Typography, Button } from "@mui/material";
import { clearStoredToken, getStoredToken } from "./api/client";
import { decodeJwtPayload } from "./api/jwt";
import { CisPage } from "./pages/CisPage";
import { CommandCenterPage } from "./pages/CommandCenterPage";
import { IncidentDetailPage } from "./pages/IncidentDetailPage";
import { IncidentsPage } from "./pages/IncidentsPage";
import { LoginPage } from "./pages/LoginPage";
import { SitesPage } from "./pages/SitesPage";

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
        <Route path="/cis" element={<CisPage />} />
        <Route path="/incidents" element={<IncidentsPage />} />
        <Route path="/incidents/:id" element={<IncidentDetailPage />} />
      </Route>
    </Routes>
  );
}
