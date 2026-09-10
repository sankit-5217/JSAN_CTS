import { Navigate, Outlet, Link, useLocation } from "react-router-dom";
import { AppBar, Box, Button, Chip, Stack, Toolbar, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { clearStoredToken, getStoredToken } from "../../api/client";
import { decodeJwtPayload, getCurrentUserRole } from "../../api/jwt";
import { theme } from "../../theme/theme";

function BrandMark() {
  return (
    <Box
      component="img"
      src="/jsan-logo.png"
      alt="JSAN"
      sx={{ height: 22, width: "auto", display: "block" }}
    />
  );
}

const NAV_ITEMS = [
  { label: "Report an issue", to: "/client/report" },
  { label: "My tickets", to: "/client/tickets" },
];

/**
 * The client/end-user shell (CTS_MANAGER_VIEWER) — deliberately not the
 * internal Sidebar/TopBar from App.tsx. A site POC doesn't need CMDB, SLA
 * policy config, alert rules or any of the other fourteen internal modules;
 * giving them the same nav as staff (even with writes blocked server-side)
 * just reads as confusing. This is a small, purpose-built portal: report an
 * issue, track it, reply when asked.
 */
export function ClientLayout() {
  const location = useLocation();
  if (!getStoredToken()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  // A staff member who wanders onto a /client/* URL gets sent back to the
  // internal console rather than seeing a portal built for someone else's
  // role — symmetric with AuthenticatedLayout's own redirect the other way.
  if (getCurrentUserRole() !== "CTS_MANAGER_VIEWER") {
    return <Navigate to="/" replace />;
  }

  const token = getStoredToken();
  const user = token ? decodeJwtPayload(token) : null;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f5f7fa" }}>
      <AppBar
        position="static"
        color="inherit"
        elevation={0}
        sx={{ bgcolor: "#fff", borderBottom: 1, borderColor: "divider" }}
      >
        <Toolbar sx={{ gap: 3, flexWrap: "wrap", py: 1 }}>
          <Stack spacing={0.4}>
            <BrandMark />
            <Typography sx={{ color: "text.secondary", fontSize: 10, letterSpacing: "0.05em" }}>
              CTS SUPPORT PORTAL
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

          {user && <Chip size="small" label="Client" variant="outlined" />}
          {user && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ display: { xs: "none", sm: "block" } }}
            >
              {user.email}
            </Typography>
          )}
          <Button
            size="small"
            onClick={() => {
              clearStoredToken();
              window.location.assign("/login");
            }}
          >
            Log out
          </Button>
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ maxWidth: 880, mx: "auto", p: { xs: 2, sm: 4 } }}>
        <Outlet />
      </Box>
    </Box>
  );
}
