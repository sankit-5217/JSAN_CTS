import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Badge,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItemButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AssignmentIndOutlinedIcon from "@mui/icons-material/AssignmentIndOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import ChatBubbleOutlineOutlinedIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import FiberNewOutlinedIcon from "@mui/icons-material/FiberNewOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import NotificationsNoneOutlinedIcon from "@mui/icons-material/NotificationsNoneOutlined";
import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined";
import PanToolOutlinedIcon from "@mui/icons-material/PanToolOutlined";
import PersonOffOutlinedIcon from "@mui/icons-material/PersonOffOutlined";
import SyncAltOutlinedIcon from "@mui/icons-material/SyncAltOutlined";
import TimerOffOutlinedIcon from "@mui/icons-material/TimerOffOutlined";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import { apiGet, apiPost } from "../api/client";

type NotificationKind =
  | "INCIDENT_CREATED"
  | "INCIDENT_ASSIGNED"
  | "INCIDENT_GROUP_ASSIGNED"
  | "INCIDENT_STATUS_CHANGED"
  | "INCIDENT_COMMENT_ADDED"
  | "SLA_WARNING"
  | "SLA_BREACHED"
  | "INCIDENT_OFFERED"
  | "INCIDENT_OFFER_UNACCEPTED"
  | "ALERT_RECOVERED";

interface InAppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  entityType: string;
  entityId: string;
  readAt: string | null;
  createdAt: string;
}

interface NotificationList {
  items: InAppNotification[];
  unreadCount: number;
}

// Same cadence family as the other live views (incident page 4s, roster
// 30s). The bell is on every page, so it polls less often than a detail view.
const POLL_INTERVAL_MS = 15_000;

const KIND_STYLE: Record<NotificationKind, { icon: ReactNode; color: string }> = {
  INCIDENT_CREATED: { icon: <FiberNewOutlinedIcon fontSize="small" />, color: "#1565c0" },
  INCIDENT_ASSIGNED: { icon: <AssignmentIndOutlinedIcon fontSize="small" />, color: "#2f8f83" },
  INCIDENT_GROUP_ASSIGNED: { icon: <GroupsOutlinedIcon fontSize="small" />, color: "#2f8f83" },
  INCIDENT_STATUS_CHANGED: { icon: <SyncAltOutlinedIcon fontSize="small" />, color: "#5c6bc0" },
  INCIDENT_COMMENT_ADDED: {
    icon: <ChatBubbleOutlineOutlinedIcon fontSize="small" />,
    color: "#8e5b9f",
  },
  SLA_WARNING: { icon: <TimerOutlinedIcon fontSize="small" />, color: "#ed6c02" },
  SLA_BREACHED: { icon: <TimerOffOutlinedIcon fontSize="small" />, color: "#d32f2f" },
  INCIDENT_OFFERED: { icon: <PanToolOutlinedIcon fontSize="small" />, color: "#ed6c02" },
  ALERT_RECOVERED: {
    icon: <CheckCircleOutlineOutlinedIcon fontSize="small" />,
    color: "#2e7d32",
  },
  INCIDENT_OFFER_UNACCEPTED: {
    icon: <PersonOffOutlinedIcon fontSize="small" />,
    color: "#d32f2f",
  },
};

function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface NotificationBellProps {
  /** Where clicking a notification goes. The client portal and the ops
   *  console open the same incident under different routes. */
  linkFor: (n: { entityType: string; entityId: string }) => string | null;
}

/**
 * The in-app notification bell shared by the ops console's TopBar and the
 * client portal header. It polls GET /notifications while the tab is
 * visible, shows the unread count as a badge, and opens a list where
 * clicking an entry marks it read and opens the ticket.
 */
export function NotificationBell({ linkFor }: NotificationBellProps) {
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<NotificationList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const open = Boolean(anchorEl);

  const refetch = useCallback(() => {
    return apiGet<NotificationList>("/notifications?limit=20")
      .then((result) => {
        setData(result);
        setError(null);
        setNow(Date.now());
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    void refetch();
    const tick = () => {
      if (document.visibilityState === "visible") {
        void refetch();
      }
    };
    const intervalId = window.setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refetch]);

  const openPanel = (el: HTMLElement) => {
    setAnchorEl(el);
    void refetch();
  };

  const handleClick = (n: InAppNotification) => {
    if (!n.readAt) {
      // Optimistic: the badge drops immediately; the next poll corrects it
      // if the request failed.
      setData((prev) =>
        prev
          ? {
              unreadCount: Math.max(0, prev.unreadCount - 1),
              items: prev.items.map((i) =>
                i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i,
              ),
            }
          : prev,
      );
      apiPost(`/notifications/${n.id}/read`).catch(() => undefined);
    }
    const target = linkFor(n);
    setAnchorEl(null);
    if (target) {
      navigate(target);
    }
  };

  const handleMarkAll = () => {
    setMarkingAll(true);
    apiPost("/notifications/read-all")
      .then(() => refetch())
      .catch((err: Error) => setError(err.message))
      .finally(() => setMarkingAll(false));
  };

  const unread = data?.unreadCount ?? 0;

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton
          onClick={(e) => openPanel(e.currentTarget)}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          aria-haspopup="true"
          aria-expanded={open}
        >
          <Badge badgeContent={unread} color="error" max={99}>
            <NotificationsOutlinedIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: { width: { xs: "calc(100vw - 32px)", sm: 380 }, maxWidth: 380, mt: 1 },
          },
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 2, py: 1.25 }}
        >
          <Typography sx={{ fontWeight: 700, fontSize: 15 }}>
            Notifications
            {unread > 0 && (
              <Typography component="span" sx={{ ml: 1, fontSize: 12.5, color: "text.secondary" }}>
                {unread} unread
              </Typography>
            )}
          </Typography>
          <Button
            size="small"
            onClick={handleMarkAll}
            disabled={unread === 0 || markingAll}
            sx={{ textTransform: "none" }}
          >
            Mark all read
          </Button>
        </Stack>
        <Divider />
        <Box sx={{ maxHeight: 440, overflowY: "auto" }}>
          {error && !data && (
            <Alert severity="error" sx={{ m: 1.5 }}>
              Couldn't load notifications. {error}
            </Alert>
          )}
          {!error && !data && (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress size={24} />
            </Stack>
          )}
          {data && data.items.length === 0 && (
            <Stack alignItems="center" spacing={1} sx={{ py: 5, px: 3, color: "text.secondary" }}>
              <NotificationsNoneOutlinedIcon sx={{ fontSize: 36, opacity: 0.6 }} />
              <Typography sx={{ fontSize: 13.5 }}>You're all caught up.</Typography>
              <Typography sx={{ fontSize: 12, textAlign: "center" }}>
                Ticket offers, assignments, status changes, comments and SLA alerts will show up
                here.
              </Typography>
            </Stack>
          )}
          {data && data.items.length > 0 && (
            <List disablePadding>
              {data.items.map((n) => {
                const style = KIND_STYLE[n.kind] ?? KIND_STYLE.INCIDENT_STATUS_CHANGED;
                const isUnread = !n.readAt;
                return (
                  <ListItemButton
                    key={n.id}
                    onClick={() => handleClick(n)}
                    alignItems="flex-start"
                    sx={{
                      gap: 1.5,
                      py: 1.25,
                      borderBottom: 1,
                      borderColor: "divider",
                      bgcolor: isUnread ? alpha(style.color, 0.06) : "transparent",
                    }}
                  >
                    <Box
                      sx={{
                        mt: 0.25,
                        width: 32,
                        height: 32,
                        flexShrink: 0,
                        borderRadius: "50%",
                        display: "grid",
                        placeItems: "center",
                        color: style.color,
                        bgcolor: alpha(style.color, 0.12),
                      }}
                    >
                      {style.icon}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        sx={{ fontSize: 13.5, fontWeight: isUnread ? 700 : 500, lineHeight: 1.35 }}
                      >
                        {n.title}
                      </Typography>
                      {n.body && (
                        <Typography
                          sx={{
                            fontSize: 12.5,
                            color: "text.secondary",
                            mt: 0.25,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {n.body}
                        </Typography>
                      )}
                      <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.5 }}>
                        {timeAgo(n.createdAt, now)}
                      </Typography>
                    </Box>
                    {isUnread && (
                      <Box
                        aria-label="Unread"
                        sx={{
                          mt: 0.75,
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          bgcolor: style.color,
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </ListItemButton>
                );
              })}
            </List>
          )}
          {error && data && (
            <Typography sx={{ px: 2, py: 1, fontSize: 12, color: "error.main" }}>
              Couldn't refresh: {error}
            </Typography>
          )}
        </Box>
      </Popover>
    </>
  );
}
