import { useCallback, useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { IncidentStatus, Priority } from "@cts-dc-opsdesk/shared-types";
import { apiGet, apiPost, apiUpload, getStoredToken } from "../../api/client";
import { decodeJwtPayload } from "../../api/jwt";

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

const STATUS_LABEL: Record<IncidentStatus, string> = {
  NEW: "Received",
  ASSIGNED: "Assigned to an engineer",
  ACKNOWLEDGED: "Being worked on",
  IN_PROGRESS: "In progress",
  PENDING_VENDOR: "Waiting on a vendor",
  PENDING_CUSTOMER: "Waiting on your input",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
};

const STATUS_COLOR: Record<IncidentStatus, "info" | "warning" | "success" | "default"> = {
  NEW: "info",
  ASSIGNED: "info",
  ACKNOWLEDGED: "info",
  IN_PROGRESS: "info",
  PENDING_VENDOR: "warning",
  PENDING_CUSTOMER: "warning",
  RESOLVED: "success",
  CLOSED: "default",
  REOPENED: "warning",
  CANCELLED: "default",
};

/**
 * A site POC's view of one ticket: status, the conversation with Service
 * Desk, and a reply box. Comments here are already server-filtered to
 * customer-visible ones only (IncidentsService.listComments) — nothing to
 * hide client-side. "Who said this" is inferred from authorId vs. the
 * caller's own id (sub) rather than resolving a name: every comment this
 * role can see is either their own or Service Desk's, never a third party.
 */
export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const justCreated = Boolean((location.state as { justCreated?: boolean } | null)?.justCreated);
  const token = getStoredToken();
  const myUserId = token ? decodeJwtPayload(token)?.sub : undefined;

  const [incident, setIncident] = useState<Incident | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  const refetch = useCallback(() => {
    if (!id) return;
    setError(null);
    Promise.all([
      apiGet<Incident>(`/incidents/${id}`),
      apiGet<Comment[]>(`/incidents/${id}/comments`),
      apiGet<Attachment[]>(`/incidents/${id}/attachments`),
    ])
      .then(([inc, comm, atts]) => {
        setIncident(inc);
        setComments(comm);
        setAttachments(atts);
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const sendReply = async () => {
    if (!id || !reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      await apiPost(`/incidents/${id}/comments`, { body: reply.trim() });
      setReply("");
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (!id) return;
    setError(null);
    setUploading(true);
    try {
      await apiUpload(`/incidents/${id}/attachments`, file);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const downloadAttachment = async (attachmentId: string) => {
    setError(null);
    try {
      const { url } = await apiGet<{ url: string }>(
        `/incidents/${id}/attachments/${attachmentId}/download`,
      );
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error && !incident) {
    return <Alert severity="error">Could not load this ticket: {error}</Alert>;
  }
  if (!incident) {
    return <Typography color="text.secondary">Loading...</Typography>;
  }

  return (
    <Box>
      {justCreated && (
        <Alert severity="success" sx={{ mb: 3 }}>
          Thanks — we've received your report. Service Desk will take a look and update you here.
        </Alert>
      )}

      <Card
        elevation={0}
        sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider", mb: 3 }}
      >
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap">
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {incident.shortDescription}
            </Typography>
            <Chip
              size="small"
              color={STATUS_COLOR[incident.status]}
              label={STATUS_LABEL[incident.status]}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {incident.incidentNo} · reported {new Date(incident.createdAt).toLocaleString()}
          </Typography>
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
        Updates
      </Typography>
      <Stack spacing={1.5} sx={{ mb: 3 }}>
        {comments.length === 0 && (
          <Typography color="text.secondary">
            No updates yet — Service Desk will post here once they've taken a look.
          </Typography>
        )}
        {comments.map((c) => {
          const mine = c.authorId === myUserId;
          return (
            <Box
              key={c.id}
              sx={{
                alignSelf: mine ? "flex-end" : "flex-start",
                maxWidth: "80%",
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
                sx={{ opacity: 0.75, display: "block", mb: 0.25, fontWeight: 600 }}
              >
                {mine ? "You" : "Service Desk"} · {new Date(c.createdAt).toLocaleString()}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                {c.body}
              </Typography>
            </Box>
          );
        })}
      </Stack>

      <Divider sx={{ mb: 2 }} />
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
        Attachments
      </Typography>
      <Stack spacing={1} sx={{ mb: 3 }}>
        {attachments.length === 0 && (
          <Typography color="text.secondary">
            No attachments yet — add a photo or file if it helps explain the issue.
          </Typography>
        )}
        {attachments.map((a) => (
          <Stack key={a.id} direction="row" spacing={2} alignItems="center">
            <Typography variant="body2" sx={{ flex: 1 }}>
              {a.objectKey.split("/").pop()} ({(a.sizeBytes / 1024).toFixed(1)} KB)
            </Typography>
            <Button size="small" onClick={() => downloadAttachment(a.id)}>
              Download
            </Button>
          </Stack>
        ))}
        <Button
          component="label"
          variant="outlined"
          disabled={uploading}
          sx={{ alignSelf: "flex-start" }}
        >
          {uploading ? "Uploading..." : "Add attachment"}
          <input
            type="file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
              e.target.value = "";
            }}
          />
        </Button>
      </Stack>

      <Divider sx={{ mb: 2 }} />
      <Stack spacing={1.5}>
        <TextField
          label="Add a reply"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          multiline
          minRows={3}
          fullWidth
        />
        <Button
          variant="contained"
          disabled={!reply.trim() || sending}
          onClick={sendReply}
          sx={{ alignSelf: "flex-start", textTransform: "none", fontWeight: 600, px: 4 }}
        >
          {sending ? "Sending..." : "Send"}
        </Button>
      </Stack>
    </Box>
  );
}
