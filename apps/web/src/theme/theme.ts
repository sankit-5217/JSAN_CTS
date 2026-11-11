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

/**
 * Compact type scale, the same on every page and for every login: 13px
 * body text, headings in proportion, so a ticket's template, message box
 * and conversation fit on screen with less scrolling. `fontSize: 13` also
 * scales the rem-based sizes inside MUI components (inputs, menus,
 * buttons, chips) to match.
 */
const rem = (px: number) => `${px / 16}rem`;

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0f3d63" },
    secondary: { main: "#1565c0" },
  },
  typography: {
    fontSize: 13,
    h1: { fontSize: rem(34) },
    h2: { fontSize: rem(30) },
    h3: { fontSize: rem(26) },
    h4: { fontSize: rem(22) },
    h5: { fontSize: rem(18) },
    h6: { fontSize: rem(15) },
    subtitle1: { fontSize: rem(14) },
    subtitle2: { fontSize: rem(13) },
    body1: { fontSize: rem(13) },
    body2: { fontSize: rem(12.5) },
    button: { fontSize: rem(13) },
    caption: { fontSize: rem(11.5) },
    overline: { fontSize: rem(11) },
  },
});
