import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import PlayArrowOutlinedIcon from "@mui/icons-material/PlayArrowOutlined";
import { apiGet, apiPut } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";
import { useSoundPrefs } from "../notifications/soundPrefs";
import { installAudioUnlock, playTone } from "../notifications/tones";
import {
  URGENCIES,
  URGENCY_LABEL,
  type NotificationKind,
  type NotificationUrgency,
} from "../notifications/types";

// Mirrors NotificationSoundRulesController's SOUND_RULE_WRITE_ROLES — UI-only
// gate; the backend re-checks it.
const SOUND_RULE_WRITE_ROLES = ["SUPER_ADMIN", "DELIVERY_OPS_MANAGER"];
const LEVELS = [1, 2, 3, 4] as const;

interface SoundRuleCell {
  kind: NotificationKind;
  level: number;
  urgency: NotificationUrgency;
  isDefault: boolean;
  updatedAt: string | null;
}

const ALERT_KINDS: NotificationKind[] = ["ALERT_RAISED"];

const KIND_LABEL: Record<NotificationKind, string> = {
  INCIDENT_CREATED: "New ticket (service desk)",
  INCIDENT_ASSIGNED: "Ticket assigned to me",
  INCIDENT_GROUP_ASSIGNED: "Ticket assigned to my group",
  INCIDENT_OFFERED: "Ticket offered to me",
  INCIDENT_OFFER_UNACCEPTED: "Nobody accepted an offer",
  INCIDENT_STATUS_CHANGED: "Ticket status changed",
  INCIDENT_COMMENT_ADDED: "New comment",
  CUSTOMER_RESPONDED: 'Customer replied or answered "is it fixed?"',
  SLA_WARNING: "SLA warning",
  SLA_BREACHED: "SLA breached",
  ALERT_RAISED: "Monitoring alert raised",
  ALERT_RECOVERED: "Monitoring alert cleared",
};

const URGENCY_COLOR: Record<NotificationUrgency, "error" | "warning" | "info" | "default"> = {
  CRITICAL: "error",
  HIGH: "warning",
  NORMAL: "info",
  SILENT: "default",
};

function levelLabel(kind: NotificationKind, level: number): string {
  return ALERT_KINDS.includes(kind)
    ? ["Critical", "High", "Warning", "Info"][level - 1]
    : `P${level}`;
}

/**
 * Which sound tier each notification kind plays at each priority (or alert
 * severity). Everyone can read it; SLA policy owners can edit it. Changes
 * apply to notifications created from ~30s later; users can still turn
 * tiers down for themselves from the speaker button in the top bar.
 */
export function NotificationSoundsPage() {
  const [cells, setCells] = useState<SoundRuleCell[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const canWrite = SOUND_RULE_WRITE_ROLES.includes(getCurrentUserRole() ?? "");
  const prefs = useSoundPrefs();

  useEffect(() => {
    apiGet<SoundRuleCell[]>("/notification-sound-rules")
      .then(setCells)
      .catch((err: Error) => setError(err.message));
  }, []);

  const rows = useMemo(() => {
    const byKind = new Map<NotificationKind, SoundRuleCell[]>();
    for (const cell of cells ?? []) {
      byKind.set(cell.kind, [...(byKind.get(cell.kind) ?? []), cell]);
    }
    return (Object.keys(KIND_LABEL) as NotificationKind[])
      .filter((k) => byKind.has(k))
      .map((kind) => ({
        kind,
        cells: LEVELS.map((l) => byKind.get(kind)!.find((c) => c.level === l)),
      }));
  }, [cells]);

  const save = (cell: SoundRuleCell, urgency: NotificationUrgency) => {
    const key = `${cell.kind}:${cell.level}`;
    setSaving(key);
    setError(null);
    apiPut<SoundRuleCell>(`/notification-sound-rules/${cell.kind}/${cell.level}`, { urgency })
      .then((saved) =>
        setCells((prev) =>
          (prev ?? []).map((c) => (c.kind === saved.kind && c.level === saved.level ? saved : c)),
        ),
      )
      .catch((err: Error) => setError(`Couldn't save: ${err.message}`))
      .finally(() => setSaving(null));
  };

  const preview = (urgency: NotificationUrgency) => {
    installAudioUnlock();
    if (urgency !== "SILENT") {
      playTone(urgency, prefs.volume);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack spacing={0.5}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Notification sounds
        </Typography>
        <Typography sx={{ color: "text.secondary", fontSize: 14 }}>
          Which sound the ops console plays for each notification, by ticket priority or alert
          severity. Critical repeats every 10 seconds until the user opens the bell. Each user can
          still mute or turn tiers down for themselves from the speaker button in the top bar.
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography sx={{ fontSize: 13, color: "text.secondary" }}>Preview:</Typography>
        {URGENCIES.filter((u) => u !== "SILENT").map((u) => (
          <Chip
            key={u}
            size="small"
            color={URGENCY_COLOR[u]}
            icon={<PlayArrowOutlinedIcon />}
            label={URGENCY_LABEL[u]}
            onClick={() => preview(u)}
          />
        ))}
      </Stack>
      {!canWrite && (
        <Alert severity="info">
          Read only. Super admins and delivery ops managers can change these.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {!cells && !error && (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress size={28} />
        </Stack>
      )}
      {cells && rows.length === 0 && (
        <Alert severity="info">No notification kinds are configured.</Alert>
      )}
      {cells && rows.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Notification</TableCell>
                {LEVELS.map((l) => (
                  <TableCell key={l}>
                    P{l}
                    <Typography component="span" sx={{ fontSize: 11.5, color: "text.secondary" }}>
                      {" "}
                      / {["Critical", "High", "Warning", "Info"][l - 1]}
                    </Typography>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(({ kind, cells: row }) => (
                <TableRow key={kind}>
                  <TableCell sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                    {KIND_LABEL[kind]}
                  </TableCell>
                  {row.map((cell, i) => {
                    if (!cell) {
                      return <TableCell key={i} />;
                    }
                    const key = `${cell.kind}:${cell.level}`;
                    return (
                      <TableCell key={key}>
                        {canWrite ? (
                          <Stack direction="row" alignItems="center" spacing={0.5}>
                            <Select
                              size="small"
                              value={cell.urgency}
                              disabled={saving === key}
                              onChange={(e) => save(cell, e.target.value as NotificationUrgency)}
                              inputProps={{
                                "aria-label": `${KIND_LABEL[kind]}, ${levelLabel(kind, cell.level)}`,
                              }}
                              sx={{ minWidth: 112, fontSize: 13 }}
                            >
                              {URGENCIES.map((u) => (
                                <MenuItem key={u} value={u}>
                                  {URGENCY_LABEL[u]}
                                </MenuItem>
                              ))}
                            </Select>
                            {cell.isDefault && (
                              <Tooltip title="Default, never changed">
                                <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
                                  default
                                </Typography>
                              </Tooltip>
                            )}
                          </Stack>
                        ) : (
                          <Chip
                            size="small"
                            color={URGENCY_COLOR[cell.urgency]}
                            variant={cell.urgency === "SILENT" ? "outlined" : "filled"}
                            label={URGENCY_LABEL[cell.urgency]}
                          />
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}
