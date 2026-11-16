import { Navigate, Outlet, Link, useLocation } from "react-router-dom";
import { AppBar, Box, Button, Stack, Toolbar, Typography } from "@mui/material";
import { alpha, ThemeProvider } from "@mui/material/styles";
import { AccountMenu } from "../../components/AccountMenu";
import { NotificationBell } from "../../components/NotificationBell";
import { getStoredToken, signOut } from "../../api/client";
import { decodeJwtPayload, getCurrentUserRole, passwordChangeRequired } from "../../api/jwt";
import { clientTheme as theme } from "./clientTheme";
import { ClientAtmosphere } from "./ClientAtmosphere";

function BrandMark() {
  return (
    <Box
      component="img"
      src="/jsan-logo.png"
      alt="JSAN"
      sx={{
        height: 32,
        width: 78,
        objectFit: "contain",
        p: 0.5,
        borderRadius: 1,
        bgcolor: "#f4f8ff",
        display: "block",
      }}
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
  if (passwordChangeRequired()) {
    return <Navigate to="/auth/change-password" replace />;
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
    <ThemeProvider theme={theme}>
      <Box
        className="client-portal"
        sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", color: "text.primary" }}
      >
        <AppBar
          position="static"
          color="inherit"
          elevation={0}
          sx={{ bgcolor: "rgba(5, 9, 17, 0.92)", borderBottom: 1, borderColor: "divider" }}
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

            <Stack
              component="nav"
              aria-label="Client navigation"
              direction="row"
              spacing={0.5}
              sx={{ order: { xs: 3, sm: 0 }, width: { xs: "100%", sm: "auto" }, overflowX: "auto" }}
            >
              {NAV_ITEMS.map((item) => {
                const active = location.pathname.startsWith(item.to);
                return (
                  <Button
                    key={item.to}
                    component={Link}
                    to={item.to}
                    aria-current={active ? "page" : undefined}
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
                roleColor="#9ac8ff"
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
            p:
              location.pathname === "/client/report"
                ? { xs: 1.5, sm: 2 }
                : isFullScreenPage
                  ? { xs: 1.5, sm: 3 }
                  : { xs: 2, sm: 4 },
            display: isFullScreenPage ? "flex" : undefined,
            flexDirection: isFullScreenPage ? "column" : undefined,
          }}
        >
          <ClientAtmosphere pathname={location.pathname} />
          <Outlet />
        </Box>
      </Box>
    </ThemeProvider>
  );
}
