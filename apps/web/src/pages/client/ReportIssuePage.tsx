import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import { apiGet, apiPost, apiUpload, getStoredToken } from "../../api/client";
import { decodeJwtPayload } from "../../api/jwt";
import {
  clientGroups,
  draftProblems,
  EMPTY_DRAFT,
  toRequestBody,
  type IssueCatalog,
  type ReportDraft,
} from "./issueReporting";
import { FieldRow, IssueTemplateForm, type TemplateGroup } from "./IssueTemplateForm";

interface Site {
  id: string;
  code: string;
  name: string;
}

type SupportGroup = TemplateGroup & { isClientSelectable: boolean };

interface CreatedIncident {
  id: string;
}

/**
 * The client portal's "Report an issue" page: the issue reporting
 * template (IssueTemplateForm) in create mode, plus the site and the files
 * to attach. Status is shown, not picked: a new report is always "New"
 * (the backend state machine owns status). Reporter is the signed-in
 * account.
 */
export function ReportIssuePage() {
  const navigate = useNavigate();
  const token = getStoredToken();
  const reporterEmail = token ? (decodeJwtPayload(token)?.email ?? "") : "";

  const [catalog, setCatalog] = useState<IssueCatalog | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [groups, setGroups] = useState<SupportGroup[]>([]);
  const [siteId, setSiteId] = useState("");
  const [draft, setDraft] = useState<ReportDraft>(EMPTY_DRAFT);
  const [files, setFiles] = useState<File[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      apiGet<IssueCatalog>("/issue-reporting/catalog"),
      apiGet<{ items: Site[] } | Site[]>("/sites"),
      apiGet<SupportGroup[]>("/support-groups"),
    ])
      .then(([cat, siteRes, groupRes]) => {
        const items = Array.isArray(siteRes) ? siteRes : siteRes.items;
        setCatalog(cat);
        setSites(items);
        setGroups(clientGroups(groupRes));
        if (items.length === 1) setSiteId(items[0].id);
        // "Service Desk is default": pre-select the flagged group.
        setDraft((d) => ({ ...d, ownerGroupId: cat.defaultAssigneeGroupId ?? "" }));
      })
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  const problems = draftProblems(draft, siteId);
  const canSubmit = problems.length === 0 && !submitting && catalog !== null;

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    let incident: CreatedIncident;
    try {
      incident = await apiPost<CreatedIncident>(
        "/incidents/customer-report",
        toRequestBody(draft, siteId),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
      return;
    }
    // The ticket exists now; a failed upload shouldn't lose it. The ticket
    // page lets them attach again.
    const failedUploads: string[] = [];
    for (const file of files) {
      try {
        await apiUpload(`/incidents/${incident.id}/attachments`, file);
      } catch {
        failedUploads.push(file.name);
      }
    }
    navigate(`/client/tickets/${incident.id}`, { state: { justCreated: true, failedUploads } });
  };

  if (loadError) {
    return <Alert severity="error">Could not load the report form: {loadError}</Alert>;
  }
  if (!catalog) {
    return <Typography color="text.secondary">Loading the report form...</Typography>;
  }

  const siteRow = (
    <FieldRow label="Site">
      {sites.length > 1 ? (
        <TextField
          select
          size="small"
          fullWidth
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
          sx={{ "& .MuiInputBase-root": { bgcolor: "background.paper" } }}
        >
          {sites.map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.code} — {s.name}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <Typography sx={{ pt: 1.25 }}>
          {sites[0] ? `${sites[0].code} — ${sites[0].name}` : "No site assigned"}
        </Typography>
      )}
    </FieldRow>
  );

  const attachmentPicker = (
    <Box>
      <Button
        component="label"
        variant="outlined"
        size="small"
        startIcon={<AttachFileOutlinedIcon />}
        sx={{ textTransform: "none" }}
      >
        log file / screenshots / videos
        <input
          type="file"
          hidden
          multiple
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            setFiles((prev) => [...prev, ...picked]);
            e.target.value = "";
          }}
        />
      </Button>
      {files.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
          {files.map((f, i) => (
            <Chip
              key={`${f.name}-${i}`}
              size="small"
              label={`${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`}
              onDelete={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
            />
          ))}
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        Up to 100 MB each. Stored securely with the ticket; only people on the ticket can open them.
      </Typography>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", flex: 1, flexDirection: "column", width: "100%", minWidth: 0 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        Report an issue
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Pick a template to start from a draft, fill in what you can, and attach any logs,
        screenshots or videos. The service desk picks it up from there.
      </Typography>

      <Card
        elevation={0}
        sx={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          borderRadius: 3,
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <IssueTemplateForm
            mode="create"
            catalog={catalog}
            draft={draft}
            update={setDraft}
            groups={groups}
            reporter={reporterEmail}
            topLeft={siteRow}
            attachments={attachmentPicker}
            status={
              <TextField
                size="small"
                fullWidth
                value="New"
                InputProps={{ readOnly: true }}
                helperText="Set by the service desk as work progresses"
              />
            }
          />

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems={{ sm: "center" }}
            sx={{ mt: 3 }}
          >
            <Button
              variant="contained"
              size="large"
              disabled={!canSubmit}
              onClick={handleSubmit}
              sx={{ textTransform: "none", fontWeight: 600, px: 4 }}
            >
              {submitting
                ? files.length > 0
                  ? "Submitting and uploading..."
                  : "Submitting..."
                : "Submit"}
            </Button>
            {problems.length > 0 && !submitting && (
              <Typography variant="body2" color="text.secondary">
                {problems[0]}
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
