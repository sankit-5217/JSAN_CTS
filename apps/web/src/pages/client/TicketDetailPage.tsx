import { SlaBadge } from "./SlaBadge";
import { useAttachmentPreview } from "./AttachmentPreview";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  MenuItem,
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
import { apiGet, apiPatch, apiPost, getStoredToken } from "../../api/client";
import { decodeJwtPayload } from "../../api/jwt";
import {
  clientGroups,
  draftFromTicket,
  editProblems,
  reportEditBody,
  type IssueCatalog,
  type ReportDraft,
  type TicketFields,
} from "./issueReporting";
import { FieldRow, IssueTemplateForm, type TemplateGroup } from "./IssueTemplateForm";
import { templateStatusText } from "./issueStatus";
import {
  sendMessage,
  type AttachmentDisposition,
  type ConversationMessage,
  type TicketAttachment,
} from "./conversation";
import { ConversationScroll, MessageFiles, MessageRecord, StagedFiles } from "./MessageBubble";
import { ReportEditNote } from "./ReportEditNote";
import {
  buildConversation,
  type ConversationItem,
  isFinished,
  JOURNEY,
  journeyStep,
  PRIORITY_LABEL,
  relativeTime,
  STATUS_COLOR,
  STATUS_LABEL,
  type TicketProgress,
} from "./clientTicket";
import { describeActivity, describeClock, useClientPortal, type SlaStatus } from "./clientPortal";
import { SiteContacts } from "./SitePanel";
import { formatDateTime } from "../../time/clock";

interface Incident extends TicketFields {
  id: string;
  incidentNo: string;
  siteId: string;
  status: IncidentStatus;
  priority: Priority;
  category: string;
  createdAt: string;
}

type Comment = ConversationMessage;
type Attachment = TicketAttachment;
type SupportGroup = TemplateGroup & { isClientSelectable: boolean };

type ThreadItem = ConversationItem<Comment>;

// Same cadence as the staff incident page's comment thread would need to
// feel live, but gentler: a customer page open in a tab all day.
const POLL_INTERVAL_MS = 15_000;

/**
 * A site POC's view of one ticket. Top to bottom: what it is and who's on
 * it, where it is in the journey, what (if anything) we need from them, the
 * conversation with the service desk, and a reply box.
 *
 * The report itself is the issue template again (IssueTemplateForm in
 * edit mode): every field stays editable except Description (frozen once
 * raised) and Status (the service desk's). Comments are server-filtered to
 * customer-visible ones (IncidentsService.listComments) and carry the
 * sender's name and the files sent with them; the progress summary never
 * carries staff-only detail, so there's nothing to hide client-side.
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
  // Labels for the classification the reporter picked; raw values render
  // if this hasn't loaded.
  const [catalog, setCatalog] = useState<IssueCatalog | null>(null);
  const [groups, setGroups] = useState<SupportGroup[]>([]);
  useEffect(() => {
    apiGet<IssueCatalog>("/issue-reporting/catalog")
      .then(setCatalog)
      .catch(() => undefined);
    apiGet<SupportGroup[]>("/support-groups")
      .then((res) => setGroups(clientGroups(res)))
      .catch(() => undefined);
  }, []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  // SLA status, live activity and site contacts are extras: the ticket
  // itself still renders if the overview hasn't loaded or fails.
  const { overview, ticketsById } = useClientPortal();
  const portal = id ? ticketsById.get(id) : undefined;
  const site = overview?.sites.find((s) => s.id === (incident?.siteId ?? portal?.siteId));

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

  // Messages, status changes and the reporter's report edits, in time order.
  const thread = useMemo<ThreadItem[]>(
    () => buildConversation(comments, progress),
    [comments, progress],
  );

  const latestDeskMessage = useMemo(
    () => [...comments].reverse().find((c) => c.authorId !== myUserId) ?? null,
    [comments, myUserId],
  );

  // The message and its files go together: the files show inside it.
  const sendReply = async () => {
    if (!id || (!reply.trim() && replyFiles.length === 0)) return;
    setSending(true);
    setActionError(null);
    try {
      const { failedUploads } = await sendMessage(id, reply, replyFiles);
      setReply("");
      setReplyFiles([]);
      if (failedUploads.length > 0) {
        setActionError(
          `Your message was sent, but these files didn't upload: ${failedUploads.join(", ")}`,
        );
      }
      await refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const { openFile, previewDialog } = useAttachmentPreview(id, attachments, setActionError);

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
  const activity = portal && !finished ? describeActivity(portal.activity, relativeTime) : null;

  // Under the report's Description: the message box, then the
  // conversation (scrolling inside itself), so neither needs the page to
  // scroll.
  const belowDescription = (
    <>
      <FieldRow label="Message">
        <Box>
          {actionError && (
            <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setActionError(null)}>
              {actionError}
            </Alert>
          )}
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
            minRows={2}
            maxRows={3}
            fullWidth
          />
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mt: 0.75 }}
            flexWrap="wrap"
            useFlexGap
          >
            <Button
              variant="contained"
              disabled={(!reply.trim() && replyFiles.length === 0) || sending}
              onClick={sendReply}
              sx={{ textTransform: "none", fontWeight: 600, px: 4 }}
            >
              {sending
                ? replyFiles.length > 0
                  ? "Sending and uploading..."
                  : "Sending..."
                : "Send"}
            </Button>
            <Button
              component="label"
              variant="outlined"
              disabled={sending}
              startIcon={<AttachFileOutlinedIcon />}
              sx={{ textTransform: "none" }}
            >
              Attach photos or files
              <input
                type="file"
                hidden
                multiple
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  setReplyFiles((prev) => [...prev, ...picked]);
                  e.target.value = "";
                }}
              />
            </Button>
            <Typography variant="caption" color="text.secondary">
              Ctrl+Enter to send
            </Typography>
          </Stack>
          <StagedFiles
            files={replyFiles}
            onRemove={(i) => setReplyFiles((prev) => prev.filter((_, j) => j !== i))}
          />
        </Box>
      </FieldRow>
      <FieldRow label="Conversation">
        <ConversationScroll count={thread.length} compact>
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
                {STATUS_LABEL[item.status]} · {formatDateTime(item.at)}
              </Divider>
            ) : item.type === "edit" ? (
              <ReportEditNote key={`e-${item.at}`} edit={item.edit} />
            ) : (
              <MessageRecord
                key={item.comment.id}
                message={item.comment}
                mine={item.comment.authorId === myUserId}
                onOpen={(attachmentId, disposition) => void openFile(attachmentId, disposition)}
              />
            ),
          )}
        </ConversationScroll>
      </FieldRow>
      {site && (
        <Box component="details" sx={{ ml: { sm: "124px" }, fontSize: 12 }}>
          <Box component="summary" sx={{ cursor: "pointer", color: "primary.main" }}>
            Site contacts
          </Box>
          <Box sx={{ pt: 1 }}>
            <SiteContacts contacts={site.contacts} />
          </Box>
          <Typography variant="caption" color="text.secondary">
            Quote {incident.incidentNo} when you call or email.
          </Typography>
        </Box>
      )}
    </>
  );

  return (
    <Box sx={{ display: "flex", flex: 1, flexDirection: "column", width: "100%", minWidth: 0 }}>
      {previewDialog}
      <Link component={RouterLink} to="/client/tickets" sx={{ fontSize: 13 }}>
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

      {catalog ? (
        <TicketReportEditor
          incident={incident}
          overview={
            <Box sx={{ mb: 0.5 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mr: 1 }}>
                  {incident.shortDescription}
                </Typography>
                <Chip
                  size="small"
                  color={STATUS_COLOR[incident.status]}
                  label={templateStatusText(incident.status, incident.refIncidentNo)}
                />
                <Chip size="small" variant="outlined" label={PRIORITY_LABEL[incident.priority]} />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {incident.incidentNo} · reported {formatDateTime(incident.createdAt)}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                <EngineeringOutlinedIcon fontSize="small" color="action" />
                <Typography variant="body2">
                  {handler.engineer
                    ? `Handled by ${handler.engineer}${handler.team ? ` (${handler.team})` : ""}`
                    : handler.team
                      ? `With the ${handler.team} team`
                      : "Waiting for the service desk to assign it"}
                </Typography>
              </Stack>
              {activity && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, ml: 3.5 }}>
                  {activity}
                </Typography>
              )}

              {incident.status !== "CANCELLED" && portal?.sla && <SlaPanel sla={portal.sla} />}

              {incident.status !== "CANCELLED" && (
                <Stepper
                  activeStep={journeyStep(progress.milestones)}
                  sx={{
                    mt: 1,
                    "& .MuiStepLabel-label": { fontSize: 11 },
                    "& .MuiStepIcon-root": { fontSize: 18 },
                    "& .MuiStep-root": { px: 0.5 },
                  }}
                >
                  {JOURNEY.map((step, i) => (
                    <Step
                      key={step.label}
                      completed={
                        i < journeyStep(progress.milestones) || incident.status === "CLOSED"
                      }
                    >
                      <StepLabel>{step.label}</StepLabel>
                    </Step>
                  ))}
                </Stepper>
              )}
              <NextStepPanel
                incident={incident}
                progress={progress}
                latestDeskMessage={latestDeskMessage}
                onReply={focusReply}
                onFeedbackSent={refetch}
              />
            </Box>
          }
          catalog={catalog}
          groups={groups}
          reporter={token ? (decodeJwtPayload(token)?.email ?? "") : ""}
          siteName={site?.name ?? null}
          // Files sent with a message show in that message; the rest came
          // with the report, so they show under its Description.
          files={attachments.filter((a) => !a.commentId)}
          onOpenFile={(attachmentId, disposition) => void openFile(attachmentId, disposition)}
          onSaved={refetch}
          belowDescription={belowDescription}
        />
      ) : (
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Loading your report...
        </Typography>
      )}

      {loadError && (
        <Typography variant="caption" color="error" sx={{ display: "block", mt: 2 }}>
          Couldn't refresh: {loadError}
        </Typography>
      )}
    </Box>
  );
}

/**
 * The ticket's report, as the issue template: the reporter edits any field
 * but Description (frozen) and Status (the desk's), then saves. While
 * nothing has been touched it follows the ticket as the page refreshes;
 * once edited it holds the reporter's changes until saved or discarded.
 */
function TicketReportEditor({
  incident,
  catalog,
  groups,
  reporter,
  siteName,
  files,
  onOpenFile,
  onSaved,
  belowDescription,
  overview,
}: {
  incident: Incident;
  catalog: IssueCatalog;
  groups: SupportGroup[];
  reporter: string;
  /** The ticket's site; null until the portal overview has loaded. */
  siteName: string | null;
  files: Attachment[];
  onOpenFile: (attachmentId: string, disposition: AttachmentDisposition) => void;
  onSaved: () => Promise<void>;
  /** The message box and conversation, under the Description. */
  belowDescription: ReactNode;
  overview: ReactNode;
}) {
  const [draft, setDraft] = useState<ReportDraft>(() => draftFromTicket(incident, catalog));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(draftFromTicket(incident, catalog));
  }, [incident, catalog, dirty]);

  const update = (fn: (d: ReportDraft) => ReportDraft) => {
    setDirty(true);
    setSaved(false);
    setDraft(fn);
  };

  const locked = isFinished(incident.status);
  const body = reportEditBody(incident, draft);
  const changed = Object.keys(body).length > 0;
  const problems = editProblems(draft);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/incidents/${incident.id}/report`, body);
      await onSaved();
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      elevation={0}
      sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider", mt: 1 }}
    >
      <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <IssueTemplateForm
          compact
          overview={overview}
          mode="edit"
          catalog={catalog}
          draft={draft}
          update={update}
          groups={groups}
          reporter={reporter}
          locked={locked}
          belowDescription={belowDescription}
          // Picked when the issue was reported, then frozen: the backend
          // has no way to move a ticket to another site.
          site={
            <TextField
              select
              size="small"
              fullWidth
              disabled
              value={incident.siteId}
              helperText="Set when the issue was reported"
            >
              <MenuItem value={incident.siteId}>{siteName ?? "Loading..."}</MenuItem>
            </TextField>
          }
          attachments={
            files.length > 0 ? <MessageFiles files={files} onOpen={onOpenFile} /> : undefined
          }
          status={
            <TextField
              size="small"
              fullWidth
              value={templateStatusText(incident.status, incident.refIncidentNo)}
              InputProps={{ readOnly: true }}
              helperText="Set by the service desk as work progresses"
            />
          }
        />
        {!locked && (
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            alignItems={{ sm: "center" }}
            sx={{ mt: 1.5 }}
          >
            <Button
              variant="contained"
              disabled={!changed || problems.length > 0 || saving}
              onClick={() => void save()}
              sx={{ textTransform: "none", fontWeight: 600, px: 4 }}
            >
              {saving ? "Saving..." : "Save changes"}
            </Button>
            {dirty && (
              <Button
                disabled={saving}
                onClick={() => {
                  setDirty(false);
                  setError(null);
                }}
                sx={{ textTransform: "none" }}
              >
                Discard
              </Button>
            )}
            <Typography variant="body2" color="text.secondary">
              {problems[0] ??
                (saved && !dirty
                  ? "Saved. The service desk has been told."
                  : changed
                    ? "You have unsaved changes"
                    : "")}
            </Typography>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

/** Response and resolution targets, each with where it stands. */
function SlaPanel({ sla }: { sla: SlaStatus }) {
  const rows = [
    { kind: "response", label: "Response", clock: sla.response },
    { kind: "resolution", label: "Resolution", clock: sla.resolution },
  ] as const;
  return (
    <Box
      sx={{
        mt: 0.75,
        p: 0.75,
        borderRadius: 2,
        bgcolor: "action.hover",
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        gap: 1.5,
      }}
    >
      {rows.map((row) => (
        <Box key={row.kind}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              {row.label} target
            </Typography>
            <SlaBadge state={row.clock.state} />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25 }}>
            {describeClock(row.kind, row.clock)}
          </Typography>
        </Box>
      ))}
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
