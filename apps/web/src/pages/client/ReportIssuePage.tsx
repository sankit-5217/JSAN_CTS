import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { apiGet, apiPost } from "../../api/client";

interface Site {
  id: string;
  code: string;
  name: string;
}

interface CreatedIncident {
  id: string;
}

// Mirrors CUSTOMER_ISSUE_CATEGORIES in
// apps/api/src/modules/incidents/dto/create-incident-as-customer.dto.ts —
// a deliberately small, plain-language set. The full free-text `category`
// field on the internal create form is a triage concept, not something a
// site POC should have to guess at.
const ISSUE_CATEGORIES = [
  { value: "HARDWARE_FAILURE", label: "Hardware fault (server, disk, PSU...)" },
  { value: "NETWORK", label: "Network / connectivity" },
  { value: "POWER", label: "Power" },
  { value: "COOLING", label: "Cooling / temperature" },
  { value: "ACCESS_REQUEST", label: "Access request" },
  { value: "OTHER", label: "Something else" },
];

/**
 * The client portal's one write: a site POC describing a problem in their
 * own words. No priority/impact/urgency picker on purpose — that's a
 * triage call Service Desk makes after intake (see
 * IncidentsService.createFromCustomer), not something a customer should
 * have to guess correctly.
 */
export function ReportIssuePage() {
  const navigate = useNavigate();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState("");
  const [category, setCategory] = useState(ISSUE_CATEGORIES[0].value);
  const [shortDescription, setShortDescription] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiGet<{ items: Site[] } | Site[]>("/sites")
      .then((res) => {
        const items = Array.isArray(res) ? res : res.items;
        setSites(items);
        if (items.length === 1) {
          setSiteId(items[0].id);
        }
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const canSubmit = siteId && category && shortDescription.trim().length >= 2 && !submitting;

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const incident = await apiPost<CreatedIncident>("/incidents/customer-report", {
        siteId,
        category,
        shortDescription: shortDescription.trim(),
        details: details.trim() || undefined,
      });
      navigate(`/client/tickets/${incident.id}`, { state: { justCreated: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        Report an issue
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Tell us what's happening — our Service Desk will pick it up, classify it, and keep you
        updated here.
      </Typography>

      <Card elevation={0} sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Stack spacing={2.5}>
            {sites.length > 1 && (
              <TextField
                select
                label="Site"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                fullWidth
              >
                {sites.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {sites.length === 1 && (
              <Typography variant="body2" color="text.secondary">
                Site: {sites[0].code} — {sites[0].name}
              </Typography>
            )}

            <TextField
              select
              label="What kind of issue is it?"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              fullWidth
            >
              {ISSUE_CATEGORIES.map((c) => (
                <MenuItem key={c.value} value={c.value}>
                  {c.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Short summary"
              placeholder="e.g. Server in Rack 3 is showing a red fault light"
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              fullWidth
            />

            <TextField
              label="More detail (optional)"
              placeholder="Anything else that might help — when it started, what you've already tried, etc."
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              multiline
              minRows={4}
              fullWidth
            />

            <Button
              variant="contained"
              size="large"
              disabled={!canSubmit}
              onClick={handleSubmit}
              sx={{ alignSelf: "flex-start", textTransform: "none", fontWeight: 600, px: 4 }}
            >
              {submitting ? "Submitting..." : "Submit"}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
