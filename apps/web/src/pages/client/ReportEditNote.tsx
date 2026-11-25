import { Box, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import EditNoteOutlinedIcon from "@mui/icons-material/EditNoteOutlined";
import { formatDateTime } from "../../time/clock";
import { senderLabel } from "./conversation";
import type { ReportEdit } from "./clientTicket";

/**
 * Changes made to the report, shown in the ticket's conversation to both
 * the client and the staff: who (by email), when (in the viewer's own
 * clock, zone written) and each field's old → new value. One box holds a
 * person's back-to-back edits (see buildConversation).
 */
export function ReportEditNote({ edit }: { edit: ReportEdit }) {
  return (
    <Box
      sx={(t) => ({
        alignSelf: "center",
        width: "100%",
        maxWidth: 640,
        px: 2,
        py: 1.25,
        borderRadius: 2,
        border: "1px dashed",
        borderColor: "divider",
        bgcolor: alpha(t.palette.info.main, 0.04),
      })}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <EditNoteOutlinedIcon fontSize="small" color="info" />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Report updated
          {edit.by ? ` by ${senderLabel(edit.by)}` : ""}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ ml: "auto !important" }}>
          {formatDateTime(edit.at)}
        </Typography>
      </Stack>
      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 4 }}>
        {edit.changes.map((c) => (
          <Typography component="li" variant="body2" key={c.label}>
            <strong>{c.label}</strong>
            {edit.detailed ? `: ${c.from ?? "none"} → ${c.to ?? "none"}` : " changed"}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}
