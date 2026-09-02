import { createTheme } from "@mui/material/styles";

/**
 * Consistent severity/status colors per spec §19: Healthy, Warning,
 * Critical, Unknown, Maintenance. Never rely on color alone — always pair
 * with a text/icon label (accessibility rule, §18).
 */
export const severityColors = {
  healthy: "#2e7d32",
  warning: "#ed6c02",
  critical: "#c62828",
  unknown: "#757575",
  maintenance: "#1565c0",
} as const;

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0f3d63" },
    secondary: { main: "#1565c0" },
  },
});
