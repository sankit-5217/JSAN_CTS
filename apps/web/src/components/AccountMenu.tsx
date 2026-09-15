import { useState } from "react";
import { Avatar, Box, Divider, Menu, MenuItem, Stack, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";

// Role identity colors — deliberately outside the severity palette
// (severityColors in theme/theme.ts: green/orange/red/blue-maintenance) so a
// role badge never reads as a health status. One entry per UserRole (spec
// §5's 8 roles); roleMeta falls back to a neutral slate for anything else.
const ROLE_META: Record<string, { label: string; color: string }> = {
  SUPER_ADMIN: { label: "Super Admin", color: "#0f3d63" },
  SERVICE_DESK_NOC: { label: "Service Desk / NOC", color: "#1565c0" },
  SITE_ENGINEER: { label: "Site Engineer", color: "#2f8f83" },
  INFRASTRUCTURE_LEAD: { label: "Infrastructure Lead", color: "#5c6bc0" },
  VENDOR_COORDINATOR: { label: "Vendor Coordinator", color: "#8e5b9f" },
  DELIVERY_OPS_MANAGER: { label: "Delivery Ops Manager", color: "#536da7" },
  CTS_MANAGER_VIEWER: { label: "Client Manager (Viewer)", color: "#6b7c93" },
  AUDITOR_READ_ONLY: { label: "Auditor (Read Only)", color: "#5c5f66" },
};

export function roleMeta(role: string): { label: string; color: string } {
  return ROLE_META[role] ?? { label: role, color: "#5c5f66" };
}

/** Initials for the avatar — no display-name field on the JWT, so this reads
 * from the email local-part (e.g. "priya.singh@..." -> "PS", "admin@..." -> "A"). */
export function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[.\-_]+/).filter(Boolean);
  const chars = parts.length >= 2 ? [parts[0][0], parts[1][0]] : [local.slice(0, 2)];
  return chars.join("").toUpperCase();
}

interface AccountMenuProps {
  email: string;
  roleLabel: string;
  roleColor: string;
  onLogout: () => void;
}

/** The interactive identity pill shared by the internal console's TopBar
 * (App.tsx) and the client portal's ClientLayout: avatar + role + email,
 * opening a menu with account details and logout. Kept as one component so
 * both shells stay visually in sync instead of drifting into two
 * hand-styled headers. */
export function AccountMenu({ email, roleLabel, roleColor, onLogout }: AccountMenuProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const menuOpen = Boolean(anchorEl);

  return (
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
            borderColor: alpha(roleColor, 0.28),
            borderRadius: 999,
            pl: 0.5,
            pr: 1.25,
            py: 0.5,
            bgcolor: menuOpen ? alpha(roleColor, 0.14) : alpha(roleColor, 0.07),
            cursor: "pointer",
            font: "inherit",
            transition: "background-color 150ms ease, box-shadow 150ms ease",
            "&:hover": { bgcolor: alpha(roleColor, 0.14) },
            "&:focus-visible": { boxShadow: `0 0 0 3px ${alpha(roleColor, 0.3)}` },
          }}
        >
          <Avatar
            sx={{ width: 30, height: 30, bgcolor: roleColor, fontSize: 12.5, fontWeight: 700 }}
          >
            {initialsFromEmail(email)}
          </Avatar>
          <Box sx={{ display: { xs: "none", sm: "block" }, textAlign: "left", minWidth: 0 }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: roleColor, lineHeight: 1.2 }}>
              {roleLabel}
            </Typography>
            <Typography
              noWrap
              sx={{ fontSize: 11.5, color: "text.secondary", lineHeight: 1.3, maxWidth: 180 }}
            >
              {email}
            </Typography>
          </Box>
          <ExpandMoreOutlinedIcon
            fontSize="small"
            sx={{
              color: roleColor,
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
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: roleColor }}>
            {roleLabel}
          </Typography>
          <Typography noWrap sx={{ fontSize: 12, color: "text.secondary" }}>
            {email}
          </Typography>
        </Box>
        <Divider sx={{ display: { xs: "block", sm: "none" } }} />
        <MenuItem onClick={onLogout} sx={{ color: "error.main", gap: 1 }}>
          <LogoutOutlinedIcon fontSize="small" />
          Log out
        </MenuItem>
      </Menu>
    </>
  );
}
