import { Chip } from "@mui/material";
import type { Priority } from "@cts-dc-opsdesk/shared-types";

/**
 * Subject-specific colour coding for the client portal: each issue type,
 * priority and severity gets its own hue so a glance tells them apart.
 * Tones are tuned for the light surfaces — dark text on a pale tint with a
 * matching border — and never rely on colour alone (the label always shows).
 */
export interface Tone {
  text: string;
  border: string;
  bg: string;
}

const RED: Tone = { text: "#b3261e", border: "#f0b4ae", bg: "#fdecea" };
const AMBER: Tone = { text: "#8a5a00", border: "#eecf9a", bg: "#fdf3e0" };
const ORANGE: Tone = { text: "#b26a00", border: "#f0cfa0", bg: "#fdf3e0" };
const BLUE: Tone = { text: "#0d47a1", border: "#b9d4f5", bg: "#e7f0fc" };
const TEAL: Tone = { text: "#00695c", border: "#a7d8d2", bg: "#e0f2f1" };
const PURPLE: Tone = { text: "#6a1b9a", border: "#d9b8e8", bg: "#f3e5f5" };
const GREEN: Tone = { text: "#1b6e3c", border: "#b7dfc4", bg: "#e9f6ee" };
const SLATE: Tone = { text: "#33507e", border: "#c3d2ec", bg: "#eef3fb" };

/** Bug reads as a fault (red); each request kind gets a distinct hue. */
export const ISSUE_TYPE_TONE: Record<string, Tone> = {
  BUG: RED,
  CHANGE_REQUEST: AMBER,
  FEATURE_REQUEST: BLUE,
  PROCESS_REQUEST: TEAL,
  OTHER_REQUEST: PURPLE,
};

export const ISSUE_TYPE_LABEL: Record<string, string> = {
  BUG: "Bug",
  CHANGE_REQUEST: "Change request",
  FEATURE_REQUEST: "Feature request",
  PROCESS_REQUEST: "Process request",
  OTHER_REQUEST: "Other request",
};

/** The issue types shown as a count line in My tickets, in this order. */
export const ISSUE_TYPE_ORDER = [
  "BUG",
  "CHANGE_REQUEST",
  "FEATURE_REQUEST",
  "PROCESS_REQUEST",
  "OTHER_REQUEST",
] as const;

export function issueTypeLabel(value: string | null | undefined): string {
  if (!value) return "Uncategorised";
  return ISSUE_TYPE_LABEL[value] ?? value.replace(/_/g, " ").toLowerCase();
}

export const PRIORITY_TONE: Record<Priority, Tone> = {
  P1: RED,
  P2: ORANGE,
  P3: BLUE,
  P4: GREEN,
};

export const SEVERITY_TONE: Record<string, Tone> = {
  S0: RED,
  S1: ORANGE,
  S2: BLUE,
  S3: TEAL,
};

function ToneChip({
  tone,
  label,
  size = "small",
  title,
}: {
  tone: Tone;
  label: string;
  size?: "small" | "medium";
  title?: string;
}) {
  return (
    <Chip
      size={size}
      label={label}
      title={title}
      sx={{
        color: tone.text,
        backgroundColor: tone.bg,
        border: "1px solid",
        borderColor: tone.border,
        borderRadius: 2,
        fontWeight: 650,
        height: size === "small" ? 24 : 28,
        "& .MuiChip-label": { px: 1 },
      }}
    />
  );
}

/** A coloured issue-type chip (Bug red, Change amber, Feature blue…). */
export function IssueTypeChip({
  value,
  label,
  size,
}: {
  value: string | null | undefined;
  label?: string;
  size?: "small" | "medium";
}) {
  const tone = (value && ISSUE_TYPE_TONE[value]) || SLATE;
  return <ToneChip tone={tone} label={label ?? issueTypeLabel(value)} size={size} />;
}

/** A coloured priority chip; defaults to the P-code, pass a fuller label if wanted. */
export function PriorityChip({
  priority,
  label,
  size,
}: {
  priority: Priority;
  label?: string;
  size?: "small" | "medium";
}) {
  return <ToneChip tone={PRIORITY_TONE[priority]} label={label ?? priority} size={size} />;
}

/** A coloured severity chip (S0 most severe). Hidden when no severity is set. */
export function SeverityChip({
  value,
  size,
}: {
  value: string | null | undefined;
  size?: "small" | "medium";
}) {
  if (!value) return null;
  return <ToneChip tone={SEVERITY_TONE[value] ?? SLATE} label={value} size={size} />;
}