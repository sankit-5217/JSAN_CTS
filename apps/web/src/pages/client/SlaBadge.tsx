import { Chip } from "@mui/material";
import AccessTimeOutlinedIcon from "@mui/icons-material/AccessTimeOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import type { SlaClockState } from "./clientPortal";
import { SLA_LABEL } from "./clientPortal";

const tones: Record<SlaClockState, { text: string; border: string; background: string }> = {
  BREACHED: { text: "#b3261e", border: "#f0b4ae", background: "#fdecea" },
  AT_RISK: { text: "#8a5a00", border: "#eecf9a", background: "#fdf3e0" },
  ON_TRACK: { text: "#1b6e3c", border: "#b7dfc4", background: "#e9f6ee" },
  MET: { text: "#1b6e3c", border: "#b7dfc4", background: "#e9f6ee" },
  PAUSED: { text: "#33507e", border: "#c3d2ec", background: "#eef3fb" },
};

/** Readable SLA states on the client's light surfaces; labels retain the meaning. */
export function SlaBadge({ state, label }: { state: SlaClockState; label?: string }) {
  const tone = tones[state];
  return (
    <Chip
      size="small"
      variant="outlined"
      label={label ?? SLA_LABEL[state]}
      icon={state === "BREACHED" ? <ErrorOutlineIcon /> : <AccessTimeOutlinedIcon />}
      sx={{
        color: tone.text,
        backgroundColor: tone.background,
        borderColor: tone.border,
        borderRadius: 2,
        fontWeight: 650,
        height: 26,
        boxShadow: state === "BREACHED" ? "0 0 0 1px rgba(179,38,30,0.05)" : "none",
        "& .MuiChip-icon": { color: "inherit", fontSize: 16 },
        "& .MuiChip-label": { px: 1 },
      }}
    />
  );
}
