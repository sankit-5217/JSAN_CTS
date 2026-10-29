import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import {
  attachmentName,
  roleLabel,
  type AttachmentDisposition,
  type ConversationMessage,
  type TicketAttachment,
} from "./conversation";
import { formatDateTime } from "../../time/clock";
import { FieldRow, RECORD_BOX_SX } from "./IssueTemplateForm";

/**
 * One message on a ticket's conversation, the same on the client portal
 * and the staff incident page: the sender's name and role on top, then the
 * words, then any files sent with it (each with View and Download).
 */
export function MessageBubble({
  message,
  mine,
  tag,
  onOpen,
}: {
  message: ConversationMessage;
  mine: boolean;
  /** A small label after the name (staff side: Internal / To customer). */
  tag?: { label: string; color?: "default" | "info" | "warning" };
  onOpen: (attachmentId: string, disposition: AttachmentDisposition) => void;
}) {
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
      <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          {message.author.displayName}
          {mine ? " (you)" : ""}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.8 }}>
          {roleLabel(message.author.role)} · {formatDateTime(message.createdAt)}
        </Typography>
        {tag && (
          <Chip
            size="small"
            label={tag.label}
            color={tag.color ?? "default"}
            variant="outlined"
            sx={{
              height: 18,
              fontSize: 11,
              ...(mine ? { color: "inherit", borderColor: "currentColor" } : {}),
            }}
          />
        )}
      </Stack>
      <Typography
        variant="body2"
        sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", mt: 0.25 }}
      >
        {message.body}
      </Typography>
      {message.attachments.length > 0 && (
        <MessageFiles files={message.attachments} mine={mine} onOpen={onOpen} />
      )}
    </Box>
  );
}

/**
 * One message on the client's "Conversation with the service desk", recorded
 * like the report's Description: the sender in the label cell, then the
 * role and time over the same grey box, whoever sent it.
 */
export function MessageRecord({
  message,
  mine,
  onOpen,
}: {
  message: ConversationMessage;
  mine: boolean;
  onOpen: (attachmentId: string, disposition: AttachmentDisposition) => void;
}) {
  return (
    <FieldRow label={`${message.author.displayName}${mine ? " (you)" : ""}`}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", pt: 1.25 }}>
        {roleLabel(message.author.role)} · {formatDateTime(message.createdAt)}
      </Typography>
      <Box sx={{ ...RECORD_BOX_SX, mt: 0.5 }}>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {message.body}
        </Typography>
        {message.attachments.length > 0 && (
          <MessageFiles files={message.attachments} onOpen={onOpen} />
        )}
      </Box>
    </FieldRow>
  );
}

/**
 * Files on a ticket, each with View (opens in the browser) and Download
 * (saves it). Used inside messages and under the report's Description.
 */
export function MessageFiles({
  files,
  mine = false,
  onOpen,
}: {
  files: TicketAttachment[];
  mine?: boolean;
  onOpen: (attachmentId: string, disposition: AttachmentDisposition) => void;
}) {
  const buttonSx = mine ? { color: "inherit", borderColor: "currentColor" } : {};
  return (
    <Stack spacing={0.75} sx={{ mt: 1 }}>
      {files.map((a) => (
        <Stack
          key={a.id}
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <AttachFileOutlinedIcon fontSize="small" sx={{ opacity: 0.8 }} />
          <Typography variant="body2" sx={{ flex: 1, minWidth: 120, overflowWrap: "anywhere" }}>
            {attachmentName(a)} ({(a.sizeBytes / 1024).toFixed(1)} KB)
          </Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<VisibilityOutlinedIcon fontSize="small" />}
            onClick={() => onOpen(a.id, "inline")}
            sx={{ textTransform: "none", ...buttonSx }}
          >
            View
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<FileDownloadOutlinedIcon fontSize="small" />}
            onClick={() => onOpen(a.id, "attachment")}
            sx={{ textTransform: "none", ...buttonSx }}
          >
            Download
          </Button>
        </Stack>
      ))}
    </Stack>
  );
}

/** Files picked for the next message, each removable before sending. */
export function StagedFiles({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (files.length === 0) return null;
  return (
    <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
      {files.map((f, i) => (
        <Chip
          key={`${f.name}-${i}`}
          size="small"
          icon={<AttachFileOutlinedIcon fontSize="small" />}
          label={`${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`}
          onDelete={() => onRemove(i)}
        />
      ))}
    </Stack>
  );
}
