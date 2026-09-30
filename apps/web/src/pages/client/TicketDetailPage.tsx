import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink, useLocation, useParams } from "react-router-dom";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Link,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import EngineeringOutlinedIcon from "@mui/icons-material/EngineeringOutlined";
import ReportGmailerrorredOutlinedIcon from "@mui/icons-material/ReportGmailerrorredOutlined";
import type { IncidentStatus, Priority } from "@cts-dc-opsdesk/shared-types";
import { apiGet, apiPost, apiUpload, getStoredToken } from "../../api/client";
import { decodeJwtPayload } from "../../api/jwt";
import {
  isFinished,
  JOURNEY,
  journeyStep,
  PRIORITY_LABEL,
  relativeTime,
  STATUS_COLOR,
  STATUS_LABEL,
  type TicketProgress,
} from "./clientTicket";

interface Incident {
  id: string;
  incidentNo: string;
  status: IncidentStatus;
  priority: Priority;
  category: string;
  shortDescription: string;
  createdAt: string;
}

interface Comment {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

interface Attachment {
  id: string;
  objectKey: string;
  sizeBytes: number;
  createdAt: string;
}

type ThreadItem =
  | { type: "comment"; at: string; comment: Comment }
  | { type: "status"; at: string; status: IncidentStatus };

// Same cadence as the staff incident page's comment thread would need to
// feel live, but gentler: a customer page open in a tab all day.
const POLL_INTERVAL_MS = 15_000;

/**
 * A site POC's view of one ticket. Top to bottom: what it is and who's on
 * it, where it is in the journey, what (if anything) we need from them, the
 * conversation with the service desk, and a reply box.
 *
 * Comments are server-filtered to customer-visible ones
 * (IncidentsService.listComments) and the progress summary never carries
 * staff-only detail, so there's nothing to hide client-side. "Who said this"
 * is the caller's own id (sub) vs. anyone else: every comment this role can
 * see is either theirs or the service desk's.
 */
export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navState = location.state as { justCreated?: boolean; failedUploads?: string[] } | null;
  const justCreated = Boolean(navState?.justCreated);
  const failedUploads = navState?.failedUploads ?? [];
  const token = getStoredToken();
  const myUserId = token ? decodeJwtPayload(token)?.sub : undefined;

  const [incident, setIncident] = useState<Incident | null>(null);
  const [progress, setProgress] = useState<TicketProgress | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);

  const refetch = useCallback(() => {
    if (!id) return Promise.resolve();
    return Promise.all([
      apiGet<Incident>(`/incidents/${id}`),
      apiGet<TicketProgress>(`/incidents/${id}/progress`),
      apiGet<Comment[]>(`/incidents/${id}/comments`),
      apiGet<Attachment[]>(`/incidents/${id}/attachments`),
    ])
      .then(([inc, prog, comm, atts]) => {
        setIncident(inc);
        setProgress(prog);
        setComments(comm);
        setAttachments(atts);
        setLoadError(null);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, [id]);

  useEffect(() => {
    void refetch();
    const tick = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refetch]);

  const thread = useMemo<ThreadItem[]>(() => {
    const items: ThreadItem[] = comments.map((c) => ({
      type: "comment",
      at: c.createdAt,
      comment: c,
    }));
    // The first milestone is the ticket being created: the report itself.
    for (const m of progress?.milestones.slice(1) ?? []) {
      items.push({ type: "status", at: m.at, status: m.status });
    }
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [comments, progress]);

  const latestDeskMessage = useMemo(
    () => [...comments].reverse().find((c) => c.authorId !== myUserId) ?? null,
    [comments, myUserId],
  );

  const sendReply = async () => {
    if (!id || !reply.trim()) return;
    setSending(true);
    setActionError(null);
    try {
      await apiPost(`/incidents/${id}/comments`, { body: reply.trim() });
      setReply("");
      await refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (!id) return;
    setActionError(null);
    setUploading(true);
    try {
      await apiUpload(`/incidents/${id}/attachments`, file);
      await refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const downloadAttachment = async (attachmentId: string) => {
    setActionError(null);
    try {
      const { url } = await apiGet<{ url: string }>(
        `/incidents/${id}/attachments/${attachmentId}/download`,
      );
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const focusReply = () => {
    replyRef.current?.focus();
    replyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  if (loadError && !incident) {
    return <Alert severity="error">Could not load this ticket: {loadError}</Alert>;
  }
  if (!incident || !progress) {
    return <Typography color="text.secondary">Loading...</Typography>;
  }

  const finished = isFinished(incident.status);
  const handler = progress.handledBy;

  return (
    <Box>
      <Link component={RouterLink} to="/client/tickets" sx={{ fontSize: 14 }}>
        ← My tickets
      </Link>

      {justCreated && (
        <Alert severity="success" sx={{ mt: 2 }}>
          <AlertTitle>We've got it: {incident.incidentNo}</AlertTitle>
          The service desk will review your report, set its priority and assign an engineer. Every
          update will appear on this page, and you'll see it in the bell at the top too.
        </Alert>
      )}

      {failedUploads.length > 0 && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          Your ticket was created, but these files didn't upload: {failedUploads.join(", ")}. You
          can attach them again below.
        </Alert>
      )}

      <Card
        elevation={0}
        sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider", my: 2 }}
      >
        <CardContent sx={{ p: { xs: 2.5, sm: 3.5 } }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h6" sx={{ fontWeight: 700, mr: 1 }}>
              {incident.shortDescription}
            </Typography>
            <Chip
              size="small"
              color={STATUS_COLOR[incident.status]}
              label={STATUS_LABEL[incident.status]}
            />
            <Chip size="small" variant="outlined" label={PRIORITY_LABEL[incident.priority]} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {incident.incidentNo} · reported {new Date(incident.createdAt).toLocaleString()}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
            <EngineeringOutlinedIcon fontSize="small" color="action" />
            <Typography variant="body2">
              {handler.engineer
                ? `Handled by ${handler.engineer}${handler.team ? ` (${handler.team})` : ""}`
                : handler.team
                  ? `With the ${handler.team} team`
                  : "Waiting for the service desk to assign it"}
            </Typography>
          </Stack>

          {incident.status !== "CANCELLED" && (
            <Stepper
              activeStep={journeyStep(progress.milestones)}
              alternativeLabel
              sx={{ mt: 3, "& .MuiStepLabel-label": { fontSize: 12 } }}
            >
              {JOURNEY.map((step, i) => (
                <Step
                  key={step.label}
                  completed={i < journeyStep(progress.milestones) || incident.status === "CLOSED"}
                >
                  <StepLabel>{step.label}</StepLabel>
                </Step>
              ))}
            </Stepper>
          )}
        </CardContent>
      </Card>

      <NextStepPanel
        incident={incident}
        progress={progress}
        latestDeskMessage={latestDeskMessage}
        onReply={focusReply}
        onFeedbackSent={refetch}
      />

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
        Conversation with the service desk
      </Typography>
      <Stack spacing={1.5} sx={{ mb: 3 }}>
        {thread.length === 0 && (
          <Typography color="text.secondary">
            No updates yet. The service desk will post here once they've taken a look.
          </Typography>
        )}
        {thread.map((item) =>
          item.type === "status" ? (
            <Divider
              key={`s-${item.at}-${item.status}`}
              sx={{ fontSize: 12, color: "text.secondary" }}
            >
              {STATUS_LABEL[item.status]} · {relativeTime(item.at)}
            </Divider>
          ) : (
            <MessageBubble
              key={item.comment.id}
              comment={item.comment}
              mine={item.comment.authorId === myUserId}
            />
          ),
        )}
      </Stack>

      <Card
        elevation={0}
        sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider", mb: 3 }}
      >
        <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
          {finished && (
            <Alert severity="info" sx={{ mb: 1.5 }}>
              This ticket is {incident.status === "CLOSED" ? "closed" : "cancelled"}. If the problem
              is back,{" "}
              <Link component={RouterLink} to="/client/report">
                report a new issue
              </Link>{" "}
              and mention {incident.incidentNo}.
            </Alert>
          )}
          <TextField
            inputRef={replyRef}
            label="Message the service desk"
            placeholder="Answer a question, share an update, or ask for news"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void sendReply();
            }}
            multiline
            minRows={3}
            fullWidth
          />
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mt: 1.5 }}
            flexWrap="wrap"
            useFlexGap
          >
            <Button
              variant="contained"
              disabled={!reply.trim() || sending}
              onClick={sendReply}
              sx={{ textTransform: "none", fontWeight: 600, px: 4 }}
            >
              {sending ? "Sending..." : "Send"}
            </Button>
            <Button
              component="label"
              variant="outlined"
              disabled={uploading}
              startIcon={<AttachFileOutlinedIcon />}
              sx={{ textTransform: "none" }}
            >
              {uploading ? "Uploading..." : "Attach a photo or file"}
              <input
                type="file"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadFile(file);
                  e.target.value = "";
                }}
              />
            </Button>
            <Typography variant="caption" color="text.secondary">
              Ctrl+Enter to send
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
        Attachments
      </Typography>
      <Stack spacing={1}>
        {attachments.length === 0 && (
          <Typography color="text.secondary" variant="body2">
            None yet. A photo of fault lights, a label or a screenshot often speeds things up.
          </Typography>
        )}
        {attachments.map((a) => (
          <Stack key={a.id} direction="row" spacing={2} alignItems="center">
            <Typography variant="body2" sx={{ flex: 1, overflowWrap: "anywhere" }}>
              {a.objectKey
                .split("/")
                .pop()
                ?.replace(/^[0-9a-f-]{36}-/, "")}{" "}
              ({(a.sizeBytes / 1024).toFixed(1)} KB)
            </Typography>
            <Button size="small" onClick={() => downloadAttachment(a.id)}>
              Download
            </Button>
          </Stack>
        ))}
      </Stack>
      {loadError && (
        <Typography variant="caption" color="error" sx={{ display: "block", mt: 2 }}>
          Couldn't refresh: {loadError}
        </Typography>
      )}
    </Box>
  );
}

function MessageBubble({ comment, mine }: { comment: Comment; mine: boolean }) {
  return (
    <Box
      sx={{
        alignSelf: mine ? "flex-end" : "flex-start",
        maxWidth: { xs: "92%", sm: "80%" },
        bgcolor: mine ? "primary.main" : "background.paper",
        color: mine ? "primary.contrastText" : "text.primary",
        border: mine ? "none" : "1px solid",
        borderColor: "divider",
        borderRadius: 3,
        px: 2,
        py: 1.25,
      }}
    >
      <Typography
        variant="caption"
        sx={{ opacity: 0.8, display: "block", mb: 0.25, fontWeight: 600 }}
      >
        {mine ? "You" : "Service desk"} · {new Date(comment.createdAt).toLocaleString()}
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {comment.body}
      </Typography>
    </Box>
  );
}

interface NextStepProps {
  incident: Incident;
  progress: TicketProgress;
  latestDeskMessage: Comment | null;
  onReply: () => void;
  onFeedbackSent: () => Promise<void>;
}

/** The one thing we need from the customer right now, if anything. */
function NextStepPanel({
  incident,
  progress,
  latestDeskMessage,
  onReply,
  onFeedbackSent,
}: NextStepProps) {
  if (incident.status === "PENDING_CUSTOMER") {
    if (progress.customerRepliedWhileWaiting) {
      return (
        <Alert severity="info" sx={{ mb: 3 }}>
          Thanks for replying. The team has been notified and will pick this back up.
        </Alert>
      );
    }
    return (
      <Alert
        severity="warning"
        sx={{ mb: 3 }}
        action={
          <Button color="inherit" size="small" onClick={onReply} sx={{ textTransform: "none" }}>
            Reply
          </Button>
        }
      >
        <AlertTitle>The service desk needs something from you</AlertTitle>
        {latestDeskMessage ? (
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            “{latestDeskMessage.body}”
          </Typography>
        ) : (
          "Work is paused until you reply. Check the conversation below."
        )}
      </Alert>
    );
  }
  if (incident.status === "RESOLVED") {
    return <FixConfirmation incidentId={incident.id} progress={progress} onSent={onFeedbackSent} />;
  }
  if (incident.status === "PENDING_VENDOR") {
    return (
      <Alert severity="info" sx={{ mb: 3 }}>
        We're waiting on a vendor (for example a replacement part). Nothing is needed from you;
        we'll update you here.
      </Alert>
    );
  }
  return null;
}

function FixConfirmation({
  incidentId,
  progress,
  onSent,
}: {
  incidentId: string;
  progress: TicketProgress;
  onSent: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"ask" | "not-fixed">("ask");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (outcome: "FIXED" | "NOT_FIXED") => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/incidents/${incidentId}/customer-feedback`, {
        outcome,
        comment: note.trim() || undefined,
      });
      setNote("");
      setMode("ask");
      await onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (progress.feedback) {
    return progress.feedback.outcome === "FIXED" ? (
      <Alert severity="success" icon={<CheckCircleOutlineOutlinedIcon />} sx={{ mb: 3 }}>
        You confirmed this is fixed. The service desk will close the ticket.
      </Alert>
    ) : (
      <Alert severity="warning" sx={{ mb: 3 }}>
        You told us it isn't fixed yet. The team has been notified and will reopen it.
      </Alert>
    );
  }

  return (
    <Card
      elevation={0}
      sx={{
        mb: 3,
        borderRadius: 3,
        border: "1px solid",
        borderColor: "success.light",
        bgcolor: (t) => alpha(t.palette.success.main, 0.05),
      }}
    >
      <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Typography sx={{ fontWeight: 700, mb: 0.5 }}>We think this is fixed. Is it?</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Your answer goes straight to the team, so they can close the ticket or pick it back up.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        )}
        {mode === "ask" ? (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="contained"
              color="success"
              disabled={busy}
              startIcon={<CheckCircleOutlineOutlinedIcon />}
              onClick={() => void send("FIXED")}
              sx={{ textTransform: "none", fontWeight: 600 }}
            >
              Yes, it's fixed
            </Button>
            <Button
              variant="outlined"
              color="warning"
              disabled={busy}
              startIcon={<ReportGmailerrorredOutlinedIcon />}
              onClick={() => setMode("not-fixed")}
              sx={{ textTransform: "none", fontWeight: 600 }}
            >
              No, still a problem
            </Button>
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            <TextField
              autoFocus
              label="What's still wrong?"
              placeholder="e.g. The fault light came back on this morning"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              multiline
              minRows={2}
              fullWidth
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                color="warning"
                disabled={busy || !note.trim()}
                onClick={() => void send("NOT_FIXED")}
                sx={{ textTransform: "none", fontWeight: 600 }}
              >
                Send to the team
              </Button>
              <Button disabled={busy} onClick={() => setMode("ask")} sx={{ textTransform: "none" }}>
                Back
              </Button>
            </Stack>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
