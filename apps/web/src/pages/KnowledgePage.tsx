import { useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Alert as MuiAlert,
  Button,
  Chip,
  Grid,
  Link,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { apiGet, apiPost } from "../api/client";

const APPROVAL_STATES = ["DRAFT", "APPROVED"];
const KNOWLEDGE_VIEWS = ["authoritative", "review-overdue"];

interface Article {
  id: string;
  title: string;
  version: number;
  approvalState: string;
  ownerId: string | null;
  reviewDueAt: string | null;
  authoritative: boolean;
  reviewOverdue: boolean;
}

/**
 * SOPs / runbooks (spec §10.14). An article always starts DRAFT; approval and
 * unpublish happen on the detail page. `authoritative` / `reviewOverdue` are
 * derived read-time flags, never stored.
 */
export function KnowledgePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [articles, setArticles] = useState<Article[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const approvalState = searchParams.get("approvalState") ?? "";
  const view = searchParams.get("view") ?? "";
  const q = searchParams.get("q") ?? "";
  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(searchParams);
    if (v) next.set(k, v);
    else next.delete(k);
    setSearchParams(next, { replace: true });
  };

  const load = () => {
    setError(null);
    const params = new URLSearchParams();
    if (approvalState) params.set("approvalState", approvalState);
    if (view) params.set("view", view);
    if (q) params.set("q", q);
    apiGet<Article[]>(`/knowledge?${params.toString()}`)
      .then(setArticles)
      .catch((err: Error) => setError(err.message));
  };
  useEffect(load, [approvalState, view, q]);

  const [form, setForm] = useState({ title: "", body: "", ownerId: "" });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const create = async () => {
    setActionError(null);
    try {
      await apiPost("/knowledge", {
        title: form.title,
        body: form.body,
        ownerId: form.ownerId || undefined,
      });
      setForm({ title: "", body: "", ownerId: "" });
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Knowledge base
      </Typography>

      {error && (
        <MuiAlert severity="error" sx={{ mb: 2 }}>
          Could not load articles: {error}
        </MuiAlert>
      )}
      {actionError && (
        <MuiAlert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </MuiAlert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              New article
            </Typography>
            <Stack spacing={2}>
              <TextField
                size="small"
                label="Title"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
              />
              <TextField
                size="small"
                multiline
                minRows={6}
                label="Body (Markdown)"
                value={form.body}
                onChange={(e) => set("body", e.target.value)}
              />
              <TextField
                size="small"
                label="Owner user id (optional)"
                value={form.ownerId}
                onChange={(e) => set("ownerId", e.target.value)}
              />
              <Button
                variant="contained"
                disabled={form.title.length < 3 || form.body.length < 3}
                onClick={create}
              >
                Save as draft
              </Button>
            </Stack>
          </Paper>
        </Grid>

        <Grid item xs={12} md={7}>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField
              select
              size="small"
              label="Approval"
              value={approvalState}
              onChange={(e) => setFilter("approvalState", e.target.value)}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">Any</MenuItem>
              {APPROVAL_STATES.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="View"
              value={view}
              onChange={(e) => setFilter("view", e.target.value)}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="">All</MenuItem>
              {KNOWLEDGE_VIEWS.map((v) => (
                <MenuItem key={v} value={v}>
                  {v}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Search title / body"
              value={q}
              onChange={(e) => setFilter("q", e.target.value)}
              fullWidth
            />
          </Stack>

          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Title</TableCell>
                  <TableCell>Version</TableCell>
                  <TableCell>State</TableCell>
                  <TableCell>Review due</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {articles.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link component={RouterLink} to={`/knowledge/${a.id}`}>
                        {a.title}
                      </Link>
                    </TableCell>
                    <TableCell>v{a.version}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <Chip
                          size="small"
                          label={a.approvalState}
                          color={a.approvalState === "APPROVED" ? "success" : "default"}
                        />
                        {a.reviewOverdue && (
                          <Chip size="small" color="warning" label="review overdue" />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {a.reviewDueAt ? new Date(a.reviewDueAt).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {articles.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary">
                        No articles match these filters.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>
      </Grid>
    </>
  );
}
