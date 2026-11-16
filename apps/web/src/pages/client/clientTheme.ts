import { createTheme } from "@mui/material/styles";
import { theme } from "../../theme/theme";

/** Scoped to the client shell, including menus and dialogs rendered through portals. */
export const clientTheme = createTheme(theme, {
  palette: {
    mode: "dark",
    primary: { main: "#69b5ff", contrastText: "#06111f" },
    secondary: { main: "#84d9ff" },
    background: { default: "#050911", paper: "#0c1627" },
    text: { primary: "#e9f3ff", secondary: "#a6bad3", disabled: "#75879f" },
    divider: "rgba(125, 177, 240, 0.19)",
    action: {
      active: "#a6bad3",
      hover: "rgba(105,181,255,0.08)",
      selected: "rgba(105,181,255,0.16)",
      disabled: "#75879f",
      disabledBackground: "rgba(125,177,240,0.08)",
    },
    info: { main: "#75c7ff" },
    success: { main: "#7bd8ae" },
    warning: { main: "#ffc875" },
    error: { main: "#ff929e" },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiCard: {
      styleOverrides: {
        root: {
          background: "linear-gradient(135deg, #101e33, #0b1423)",
          border: "1px solid rgba(125,177,240,0.19)",
          boxShadow: "0 12px 35px rgba(0,0,0,0.22)",
          borderRadius: 16,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 10 },
        containedPrimary: {
          background: "linear-gradient(115deg, #80ceff, #579eff)",
          color: "#051021",
          boxShadow: "0 4px 20px rgba(48,132,255,0.23)",
          "&.Mui-disabled": { background: "#1b2b40", color: "#7f94af", boxShadow: "none" },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: 10, backgroundColor: "#0a1424" } },
    },
    MuiTableCell: { styleOverrides: { head: { color: "#c2dcff", backgroundColor: "#101e33" } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: "#203652", color: "#edf6ff" } } },
    MuiDialog: { styleOverrides: { paper: { border: "1px solid rgba(125,177,240,0.25)" } } },
    MuiMenu: { styleOverrides: { paper: { border: "1px solid rgba(125,177,240,0.25)" } } },
  },
});
