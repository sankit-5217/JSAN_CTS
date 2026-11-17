import { useState } from "react";
import { Navigate, Outlet, Link, useLocation } from "react-router-dom";
import { AppBar, Box, Button, Drawer, IconButton, Stack, Toolbar, Typography } from "@mui/material";
import { alpha, ThemeProvider } from "@mui/material/styles";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import PostAddRoundedIcon from "@mui/icons-material/PostAddRounded";
import ConfirmationNumberRoundedIcon from "@mui/icons-material/ConfirmationNumberRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import { AccountMenu } from "../../components/AccountMenu";
import { NotificationBell } from "../../components/NotificationBell";
import { getStoredToken, signOut } from "../../api/client";
import { decodeJwtPayload, getCurrentUserRole, passwordChangeRequired } from "../../api/jwt";
import { clientTheme as theme } from "./clientTheme";
import { ClientAtmosphere } from "./ClientAtmosphere";

function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <Box
      component="img"
      src="/jsan-logo.png"
      alt="JSAN"
      sx={{
        height: large ? 54 : 34,
        width: large ? 138 : 86,
        objectFit: "contain",
        objectPosition: "left center",
        display: "block",
      }}
    />
  );
}

const NAV_ITEMS = [
  { label: "Home", to: "/client/home", icon: <HomeRoundedIcon fontSize="small" /> },
  { label: "Report an issue", to: "/client/report", icon: <PostAddRoundedIcon fontSize="small" /> },
  {
    label: "My tickets",
    to: "/client/tickets",
    icon: <ConfirmationNumberRoundedIcon fontSize="small" />,
  },
];

/**
 * The client/end-user shell (CLIENT_MANAGER_VIEWER) — deliberately not the
 * internal Sidebar/TopBar from App.tsx. A site POC doesn't need CMDB, SLA
 * policy config, alert rules or any of the other fourteen internal modules;
 * giving them the same nav as staff (even with writes blocked server-side)
 * just reads as confusing. This is a small, purpose-built portal: a left
 * panel of Home, Report an issue and My tickets, a home page of what needs
 * the customer, and each ticket's conversation with the service desk.
 */
export function ClientLayout() {
  const location = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
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
  const compactWorkspace =
    location.pathname === "/client/report" || location.pathname.startsWith("/client/tickets");
  const isFullScreenPage =
    location.pathname === "/client/home" ||
    location.pathname === "/client/report" ||
    location.pathname === "/client/tickets" ||
    location.pathname.startsWith("/client/tickets/");

  const nav = (
    <Stack component="nav" aria-label="Client navigation" spacing={0.5} sx={{ px: 1.5 }}>
      {NAV_ITEMS.map((item) => {
        const active = location.pathname.startsWith(item.to);
        return (
          <Button
            key={item.to}
            component={Link}
            to={item.to}
            startIcon={item.icon}
            aria-current={active ? "page" : undefined}
            onClick={() => setMobileNav(false)}
            sx={{
              justifyContent: "flex-start",
              textTransform: "none",
              fontWeight: active ? 700 : 500,
              fontSize: 14,
              px: 1.5,
              py: 1,
              borderRadius: 2,
              color: active ? theme.palette.primary.dark : "text.secondary",
              bgcolor: active ? alpha(theme.palette.primary.main, 0.1) : "transparent",
              "& .MuiButton-startIcon": { color: active ? theme.palette.primary.main : "inherit" },
              "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.08) },
            }}
          >
            {item.label}
          </Button>
        );
      })}
    </Stack>
  );

  const account = user && (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <NotificationBell
        linkFor={(n) => (n.entityType === "INCIDENT" ? `/client/tickets/${n.entityId}` : null)}
      />
      <AccountMenu
        email={user.email}
        roleLabel="Client"
        roleColor="#1565c0"
        onLogout={signOut}
      />
    </Stack>
  );

  const brand = (
    <Stack spacing={0.75} sx={{ px: 2.5 }}>
      <BrandMark large />
      <Typography
        sx={{
          fontWeight: 800,
          fontSize: 18,
          lineHeight: 1.2,
          letterSpacing: "-0.01em",
          color: "text.primary",
        }}
      >
        JSAN Support Portal
      </Typography>
      <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>
        Data center service desk
      </Typography>
    </Stack>
  );

  return (
    <ThemeProvider theme={theme}>
      <Box
        className="client-portal"
        sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", color: "text.primary" }}
      >
        {/* Mobile top bar */}
        <AppBar
          position="sticky"
          color="inherit"
          elevation={0}
          sx={{
            display: { xs: "flex", md: "none" },
            bgcolor: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(8px)",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Toolbar sx={{ gap: 1, minHeight: "64px !important" }}>
            <IconButton
              edge="start"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
              sx={{ color: "text.primary" }}
            >
              <MenuRoundedIcon />
            </IconButton>
            <BrandMark />
            <Typography sx={{ fontWeight: 800, fontSize: 15, color: "text.primary" }}>
              JSAN Support Portal
            </Typography>
            <Box sx={{ flex: 1 }} />
            {account}
          </Toolbar>
        </AppBar>

        <Drawer
          anchor="left"
          open={mobileNav}
          onClose={() => setMobileNav(false)}
          sx={{
            display: { xs: "block", md: "none" },
            "& .MuiDrawer-paper": { width: 268, bgcolor: "background.paper", py: 2.5 },
          }}
        >
          {brand}
          <Box sx={{ mt: 2 }}>{nav}</Box>
        </Drawer>

        <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Desktop left panel */}
          <Box
            component="aside"
            sx={{
              display: { xs: "none", md: "flex" },
              flexDirection: "column",
              width: 258,
              flexShrink: 0,
              position: "sticky",
              top: 0,
              height: "100vh",
              overflowY: "auto",
              py: 2.5,
              borderRight: 1,
              borderColor: "divider",
              bgcolor: "rgba(255,255,255,0.72)",
              backdropFilter: "blur(8px)",
            }}
          >
            {brand}
            <Box sx={{ mt: 3 }}>{nav}</Box>
            <Box sx={{ flex: 1 }} />
            {user && (
              <Typography
                sx={{ px: 2.5, pt: 2, fontSize: 11, color: "text.secondary", overflowWrap: "anywhere" }}
              >
                Signed in as {user.email}
              </Typography>
            )}
          </Box>

          <Box
            component="main"
            sx={{
              flex: 1,
              minWidth: 0,
              width: "100%",
              maxWidth: isFullScreenPage ? "none" : 1000,
              mx: "auto",
              p: compactWorkspace
                ? { xs: 1.5, sm: 2 }
                : isFullScreenPage
                  ? { xs: 1.5, sm: 3 }
                  : { xs: 2, sm: 4 },
              display: isFullScreenPage ? "flex" : undefined,
              flexDirection: isFullScreenPage ? "column" : undefined,
            }}
          >
            <Stack
              direction="row"
              justifyContent="flex-end"
              alignItems="center"
              sx={{ display: { xs: "none", md: "flex" }, mb: 1.5 }}
            >
              {account}
            </Stack>
            <ClientAtmosphere pathname={location.pathname} />
            <Outlet />
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}