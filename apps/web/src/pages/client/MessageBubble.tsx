import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import {
  attachmentName,
  roleLabel,
  type ConversationMessage,
  type TicketAttachment,
} from "./conversation";

/**
 * One message on a ticket's conversation, the same on the client portal
 * and the staff incident page: the sender's name and role on top, then the
 * words, then any files sent with it (each downloadable).
 */
export function MessageBubble({
  message,
  mine,
  tag,
  onDownload,
}: {
  message: ConversationMessage;
  mine: boolean;
  /** A small label after the name (staff side: Internal / To customer). */
  tag?: { label: string; color?: "default" | "info" | "warning" };
  onDownload: (attachmentId: string) => void;
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
          {roleLabel(message.author.role)} · {new Date(message.createdAt).toLocaleString()}
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
        <MessageFiles files={message.attachments} mine={mine} onDownload={onDownload} />
      )}
    </Box>
  );
}

function MessageFiles({
  files,
  mine,
  onDownload,
}: {
  files: TicketAttachment[];
  mine: boolean;
  onDownload: (attachmentId: string) => void;
}) {
  return (
    <Stack spacing={0.5} sx={{ mt: 1 }}>
      {files.map((a) => (
        <Button
          key={a.id}
          size="small"
          variant="outlined"
          startIcon={<AttachFileOutlinedIcon fontSize="small" />}
          onClick={() => onDownload(a.id)}
          sx={{
            justifyContent: "flex-start",
            textTransform: "none",
            overflowWrap: "anywhere",
            ...(mine ? { color: "inherit", borderColor: "currentColor" } : {}),
          }}
        >
          {attachmentName(a)} ({(a.sizeBytes / 1024).toFixed(1)} KB)
        </Button>
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
