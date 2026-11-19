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
import { IssueTemplateForm, type TemplateGroup } from "./IssueTemplateForm";
import { describeFailedUpload } from "./conversation";

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
        // No site is pre-selected, even when only one is offered: the
        // reporter always picks it. It can't be changed once raised.
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
      } catch (err) {
        failedUploads.push(describeFailedUpload(file, err));
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

  const sitePicker = (
    <TextField
      select
      size="small"
      fullWidth
      value={siteId}
      onChange={(e) => setSiteId(e.target.value)}
      disabled={sites.length === 0}
      helperText={
        sites.length === 0
          ? "Your account isn't linked to a site yet. Ask your JSAN contact."
          : undefined
      }
      SelectProps={{
        displayEmpty: true,
        renderValue: (v) =>
          v ? (
            (sites.find((s) => s.id === v)?.name ?? "")
          ) : (
            <Typography component="span" color="text.secondary">
              Select a site
            </Typography>
          ),
      }}
      sx={{ "& .MuiInputBase-root": { bgcolor: "background.paper" } }}
    >
      {sites.map((s) => (
        <MenuItem key={s.id} value={s.id}>
          {s.name}
        </MenuItem>
      ))}
    </TextField>
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
        <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <IssueTemplateForm
            compact
            mode="create"
            catalog={catalog}
            draft={draft}
            update={setDraft}
            groups={groups}
            reporter={reporterEmail}
            site={sitePicker}
            attachments={attachmentPicker}
            status={
              <TextField size="small" fullWidth value="New" InputProps={{ readOnly: true }} />
            }
          />

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems={{ sm: "center" }}
            sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: "divider" }}
          >
            <Button
              variant="contained"
              size="medium"
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
