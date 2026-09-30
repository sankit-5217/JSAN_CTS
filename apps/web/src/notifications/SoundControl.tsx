import { useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  IconButton,
  Popover,
  Slider,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import VolumeOffOutlinedIcon from "@mui/icons-material/VolumeOffOutlined";
import VolumeUpOutlinedIcon from "@mui/icons-material/VolumeUpOutlined";
import { useSoundPrefs, writeSoundPrefs } from "./soundPrefs";
import { installAudioUnlock, isAudioBlocked, playTone, subscribeAudioState } from "./tones";
import { AUDIBLE_URGENCIES, URGENCY_LABEL, type AudibleUrgency } from "./types";

// Which events land in which tier is admin config (Notification sounds
// page), so these only describe the tiers, not a fixed event list.
const TIER_HINT: Record<AudibleUrgency, string> = {
  CRITICAL: "Alarm that repeats every 10s until you open the bell.",
  HIGH: "Two-note chime, once.",
  NORMAL: "Soft ping, once.",
};

function desktopPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** Top-bar speaker button: mute, volume, per-tier toggles and desktop
 *  notifications for this user in this browser. */
export function SoundControl() {
  const prefs = useSoundPrefs();
  const blocked = useSyncExternalStore(subscribeAudioState, isAudioBlocked);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [permission, setPermission] = useState(desktopPermission);
  const silent = prefs.muted;

  const toggleDesktop = async (on: boolean) => {
    if (on && permission === "default") {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        return;
      }
    }
    writeSoundPrefs({ desktop: on });
  };

  const label = silent
    ? "Sound alerts muted"
    : blocked
      ? "Sound alerts: click anywhere to enable"
      : "Sound alerts";

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          onClick={(e) => {
            installAudioUnlock();
            setAnchorEl(e.currentTarget);
          }}
          aria-label={label}
          aria-haspopup="true"
          aria-expanded={Boolean(anchorEl)}
          sx={{ color: silent ? "text.disabled" : blocked ? "warning.main" : undefined }}
        >
          {silent ? <VolumeOffOutlinedIcon /> : <VolumeUpOutlinedIcon />}
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: { sx: { width: { xs: "calc(100vw - 32px)", sm: 340 }, maxWidth: 340, mt: 1 } },
        }}
      >
        <Stack sx={{ px: 2, py: 1.5 }} spacing={1.5}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography sx={{ fontWeight: 700, fontSize: 15 }}>Sound alerts</Typography>
            <Switch
              checked={!prefs.muted}
              onChange={(e) => writeSoundPrefs({ muted: !e.target.checked })}
              inputProps={{ "aria-label": "Sound alerts on" }}
            />
          </Stack>
          {blocked && !prefs.muted && (
            <Alert severity="warning" sx={{ py: 0 }}>
              Your browser blocks sound until you click on the page. Any click enables it.
            </Alert>
          )}
          <Box>
            <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>Volume</Typography>
            <Slider
              size="small"
              min={0}
              max={1}
              step={0.05}
              value={prefs.volume}
              disabled={prefs.muted}
              onChange={(_, v) => writeSoundPrefs({ volume: v as number })}
              onChangeCommitted={(_, v) => playTone("NORMAL", v as number)}
              aria-label="Volume"
            />
          </Box>
          <Divider />
          {AUDIBLE_URGENCIES.map((tier) => (
            <Stack key={tier} direction="row" alignItems="flex-start" spacing={1}>
              <FormControlLabel
                sx={{ flex: 1, alignItems: "flex-start", mr: 0 }}
                disabled={prefs.muted}
                control={
                  <Checkbox
                    size="small"
                    sx={{ pt: 0.25 }}
                    checked={prefs.tiers[tier]}
                    onChange={(e) =>
                      writeSoundPrefs({ tiers: { ...prefs.tiers, [tier]: e.target.checked } })
                    }
                  />
                }
                label={
                  <Box>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
                      {URGENCY_LABEL[tier]}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                      {TIER_HINT[tier]}
                    </Typography>
                  </Box>
                }
              />
              <Button
                size="small"
                sx={{ textTransform: "none", minWidth: 0 }}
                onClick={() => playTone(tier, prefs.volume)}
              >
                Test
              </Button>
            </Stack>
          ))}
          <Divider />
          <FormControlLabel
            disabled={permission === "unsupported" || permission === "denied"}
            control={
              <Switch
                size="small"
                checked={prefs.desktop && permission === "granted"}
                onChange={(e) => void toggleDesktop(e.target.checked)}
              />
            }
            label={
              <Typography sx={{ fontSize: 13.5 }}>
                Desktop notifications when this tab is in the background
              </Typography>
            }
          />
          {permission === "denied" && (
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
              Blocked in your browser's site settings.
            </Typography>
          )}
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
            These settings apply to you in this browser.{" "}
            <Link to="/notification-sounds" onClick={() => setAnchorEl(null)}>
              Which events use which tier
            </Link>
          </Typography>
        </Stack>
      </Popover>
    </>
  );
}
