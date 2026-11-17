import { createTheme } from "@mui/material/styles";
import { theme } from "../../theme/theme";

/**
 * The client portal's light surface: white cards on a soft blue-gray field,
 * navy text and a confident JSAN blue. Scoped to the client shell, including
 * menus and dialogs rendered through portals.
 */
export const clientTheme = createTheme(theme, {
  palette: {
    mode: "light",
    primary: { main: "#1565c0", light: "#4d90e0", dark: "#0d47a1", contrastText: "#ffffff" },
    secondary: { main: "#0f3d63" },
    background: { default: "#eef3f9", paper: "#ffffff" },
    text: { primary: "#12263f", secondary: "#5b6b80", disabled: "#9aa7b8" },
    divider: "rgba(18, 61, 99, 0.14)",
    action: {
      active: "#5b6b80",
      hover: "rgba(21,101,192,0.06)",
      selected: "rgba(21,101,192,0.12)",
      disabled: "#9aa7b8",
      disabledBackground: "rgba(18,61,99,0.06)",
    },
    info: { main: "#1976d2" },
    success: { main: "#2e7d32" },
    warning: { main: "#ed6c02" },
    error: { main: "#c62828" },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiCard: {
      styleOverrides: {
        root: {
          background: "#ffffff",
          border: "1px solid rgba(18,61,99,0.12)",
          boxShadow: "0 10px 30px rgba(18,61,99,0.08)",
          borderRadius: 16,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 10 },
        containedPrimary: {
          background: "linear-gradient(115deg, #1e88e5, #1565c0)",
          color: "#ffffff",
          boxShadow: "0 6px 18px rgba(21,101,192,0.28)",
          "&:hover": {
            background: "linear-gradient(115deg, #1976d2, #0d47a1)",
            boxShadow: "0 8px 22px rgba(21,101,192,0.34)",
          },
          "&.Mui-disabled": { background: "#d7e0ec", color: "#9aa7b8", boxShadow: "none" },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: 10, backgroundColor: "#ffffff" } },
    },
    MuiTableCell: {
      styleOverrides: { head: { color: "#0d47a1", backgroundColor: "#e8f0fb" } },
    },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: "#12263f", color: "#ffffff" } } },
    MuiDialog: { styleOverrides: { paper: { border: "1px solid rgba(18,61,99,0.14)" } } },
    MuiMenu: { styleOverrides: { paper: { border: "1px solid rgba(18,61,99,0.14)" } } },
  },
});