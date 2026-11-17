import { Chip } from "@mui/material";
import AccessTimeOutlinedIcon from "@mui/icons-material/AccessTimeOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import type { SlaClockState } from "./clientPortal";
import { SLA_LABEL } from "./clientPortal";

const tones: Record<SlaClockState, { text: string; border: string; background: string }> = {
  BREACHED: { text: "#ffbdca", border: "#f27795", background: "#321c30" },
  AT_RISK: { text: "#ffdb9d", border: "#ba8d45", background: "#302719" },
  ON_TRACK: { text: "#9de8cd", border: "#468d7d", background: "#122e2e" },
  MET: { text: "#9de8cd", border: "#468d7d", background: "#122e2e" },
  PAUSED: { text: "#bdcfff", border: "#647eae", background: "#1b2742" },
};

/** Readable SLA states on the client's dark surfaces; labels retain the meaning. */
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
        boxShadow:
          state === "BREACHED"
            ? "inset 0 1px 0 #ffffff0d, 0 0 14px #f2779514"
            : "inset 0 1px 0 #ffffff0d",
        "& .MuiChip-icon": { color: "inherit", fontSize: 16 },
        "& .MuiChip-label": { px: 1 },
      }}
    />
  );
}
