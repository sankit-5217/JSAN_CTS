import { Navigate, Outlet, Link, useLocation } from "react-router-dom";
import { AppBar, Box, Button, Stack, Toolbar, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { AccountMenu, roleMeta } from "../../components/AccountMenu";
import { NotificationBell } from "../../components/NotificationBell";
import { getStoredToken, signOut } from "../../api/client";
import { decodeJwtPayload, getCurrentUserRole } from "../../api/jwt";
import { theme } from "../../theme/theme";

function BrandMark() {
  return (
    <Box
      component="img"
      src="/jsan-logo.png"
      alt="JSAN"
      sx={{ height: 24, width: 70, display: "block" }}
    />
  );
}

const NAV_ITEMS = [
  { label: "Home", to: "/client/home" },
  { label: "Report an issue", to: "/client/report" },
  { label: "My tickets", to: "/client/tickets" },
];

/**
 * The client/end-user shell (CLIENT_MANAGER_VIEWER) — deliberately not the
 * internal Sidebar/TopBar from App.tsx. A site POC doesn't need CMDB, SLA
 * policy config, alert rules or any of the other fourteen internal modules;
 * giving them the same nav as staff (even with writes blocked server-side)
 * just reads as confusing. This is a small, purpose-built portal: a home
 * page of what needs the customer, reporting an issue, and each ticket's
 * conversation with the service desk.
 */
export function ClientLayout() {
  const location = useLocation();
  if (!getStoredToken()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  // A staff member who wanders onto a /client/* URL gets sent back to the
  // internal console rather than seeing a portal built for someone else's
  // role — symmetric with AuthenticatedLayout's own redirect the other way.
  if (getCurrentUserRole() !== "CLIENT_MANAGER_VIEWER") {
    return <Navigate to="/" replace />;
  }

  const token = getStoredToken();
  const user = token ? decodeJwtPayload(token) : null;
  const isFullScreenPage =
    location.pathname === "/client/home" ||
    location.pathname === "/client/report" ||
    location.pathname === "/client/tickets" ||
    location.pathname.startsWith("/client/tickets/");

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", bgcolor: "#f5f7fa" }}>
      <AppBar
        position="static"
        color="inherit"
        elevation={0}
        sx={{ bgcolor: "#fff", borderBottom: 1, borderColor: "divider" }}
      >
        <Toolbar sx={{ gap: 3, flexWrap: "wrap", py: 1.5, minHeight: "76px !important" }}>
          <Stack spacing={0.75}>
            <BrandMark />
            <Typography
              sx={{
                color: "text.secondary",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.07em",
              }}
            >
              JSAN &middot; SUPPORT PORTAL
            </Typography>
          </Stack>

          <Stack direction="row" spacing={0.5}>
            {NAV_ITEMS.map((item) => {
              const active = location.pathname.startsWith(item.to);
              return (
                <Button
                  key={item.to}
                  component={Link}
                  to={item.to}
                  sx={{
                    textTransform: "none",
                    fontWeight: active ? 700 : 500,
                    color: active ? theme.palette.primary.main : "text.secondary",
                    bgcolor: active ? alpha(theme.palette.primary.main, 0.08) : "transparent",
                    borderRadius: 2,
                  }}
                >
                  {item.label}
                </Button>
              );
            })}
          </Stack>

          <Box sx={{ flex: 1 }} />

          {user && (
            <NotificationBell
              linkFor={(n) =>
                n.entityType === "INCIDENT" ? `/client/tickets/${n.entityId}` : null
              }
            />
          )}
          {user && (
            <AccountMenu
              email={user.email}
              roleLabel="Client"
              roleColor={roleMeta("CLIENT_MANAGER_VIEWER").color}
              onLogout={signOut}
            />
          )}
        </Toolbar>
      </AppBar>

      <Box
        component="main"
        sx={{
          width: "100%",
          maxWidth: isFullScreenPage ? "none" : 880,
          mx: "auto",
          flex: isFullScreenPage ? 1 : undefined,
          p: isFullScreenPage ? { xs: 1.5, sm: 3 } : { xs: 2, sm: 4 },
          display: isFullScreenPage ? "flex" : undefined,
          flexDirection: isFullScreenPage ? "column" : undefined,
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
