import { Navigate, Outlet, Link, useLocation } from "react-router-dom";
import { AppBar, Box, Button, Chip, Stack, Toolbar, Typography } from "@mui/material";
import { alpha, darken } from "@mui/material/styles";
import { clearStoredToken, getStoredToken } from "../../api/client";
import { decodeJwtPayload, getCurrentUserRole } from "../../api/jwt";
import { theme } from "../../theme/theme";

// Same primary-derived tokens as the login page / sidebar, applied much more
// lightly here — a support portal reads as a different *kind* of product
// from the ops console, not a re-skin of it, but still unmistakably the
// same brand.
const ACCENT = theme.palette.secondary.light;
const BRAND_DARK = darken(theme.palette.primary.main, 0.45);

function BrandMark() {
  return (
    <Box
      sx={{
        width: 32,
        height: 32,
        borderRadius: "9px",
        bgcolor: ACCENT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        fontSize: 13,
        color: BRAND_DARK,
        flexShrink: 0,
      }}
    >
      OD
    </Box>
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
          <Stack direction="row" spacing={1.25} alignItems="center">
            <BrandMark />
            <Box>
              <Typography sx={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.2 }}>
                OpsDesk
              </Typography>
              <Typography sx={{ color: "text.secondary", fontSize: 10.5, letterSpacing: "0.05em" }}>
                SUPPORT PORTAL
              </Typography>
            </Box>
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
