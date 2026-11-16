import { useEffect, useId, useRef, useState } from "react";
import {
  Alert,
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import {
  attachmentName,
  openAttachment,
  type AttachmentDisposition,
  type TicketAttachment,
} from "./conversation";

interface Preview {
  name: string;
  url?: string;
  error?: string;
}

/** Shared by client and staff tickets, including files attached to messages. */
export function useAttachmentPreview(
  incidentId: string | undefined,
  attachments: TicketAttachment[],
  onError: (error: string | null) => void,
) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const request = useRef(0);
  const titleId = useId();

  useEffect(() => {
    setPreview(null);
    return () => {
      request.current += 1;
    };
  }, [incidentId]);

  const close = () => {
    request.current += 1;
    setPreview(null);
  };

  const openFile = async (attachmentId: string, disposition: AttachmentDisposition) => {
    if (!incidentId) return;
    onError(null);
    if (disposition === "attachment") {
      try {
        await openAttachment(incidentId, attachmentId, disposition);
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    const current = ++request.current;
    const attachment = attachments.find((file) => file.id === attachmentId);
    const name = attachment ? attachmentName(attachment) : "Document";
    setPreview({ name });
    // Archives cannot be rendered by the browser. Keep the user on the ticket.
    if (/\.(zip|gz|tgz)$/i.test(name)) {
      setPreview({
        name,
        error:
          "Preview is unavailable for this file type. Close this preview and use the download icon to save the file.",
      });
      return;
    }
    try {
      const url = await openAttachment(incidentId, attachmentId, "inline");
      if (request.current === current && url) setPreview({ name, url });
    } catch (err) {
      if (request.current === current) {
        setPreview({ name, error: err instanceof Error ? err.message : String(err) });
      }
    }
  };

  const previewDialog = (
    <Dialog
      open={preview !== null}
      onClose={close}
      fullWidth
      maxWidth="lg"
      aria-labelledby={titleId}
    >
      <DialogTitle id={titleId} sx={{ pr: 7, overflowWrap: "anywhere" }}>
        {preview?.name}
        <Tooltip title="Close preview">
          <IconButton
            aria-label="Close preview"
            onClick={close}
            sx={{ position: "absolute", right: 12, top: 12 }}
          >
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent
        dividers
        sx={{
          p: 0,
          height: "75vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {preview?.error ? (
          <Alert severity="warning" sx={{ m: 2 }}>
            {preview.error}
          </Alert>
        ) : preview?.url ? (
          /\.(png|jpe?g|gif|webp|heic)$/i.test(preview.name) ? (
            <Box
              component="img"
              src={preview.url}
              alt={preview.name}
              sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          ) : /\.(mp4|webm|mov|mkv)$/i.test(preview.name) ? (
            <Box
              component="video"
              src={preview.url}
              controls
              sx={{ maxWidth: "100%", maxHeight: "100%" }}
            />
          ) : (
            <Box
              component="iframe"
              src={preview.url}
              title={preview.name}
              sandbox="allow-scripts allow-same-origin"
              sx={{ width: "100%", height: "100%", border: 0 }}
            />
          )
        ) : (
          <CircularProgress aria-label="Loading document preview" />
        )}
      </DialogContent>
    </Dialog>
  );

  return { openFile, previewDialog };
}
