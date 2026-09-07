import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert as MuiAlert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { apiGet, apiPatch, apiPost } from "../api/client";

interface Article {
  id: string;
  title: string;
  body: string;
  version: number;
  approvalState: string;
  ownerId: string | null;
  reviewDueAt: string | null;
  authoritative: boolean;
  reviewOverdue: boolean;
}

export function KnowledgeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!id) return;
    setError(null);
    apiGet<Article>(`/knowledge/${id}`)
      .then(setArticle)
      .catch((err: Error) => setError(err.message));
  }, [id]);
  useEffect(() => {
    refetch();
  }, [refetch]);

  const [edit, setEdit] = useState<null | Record<string, string>>(null);
  const [approverId, setApproverId] = useState("");
  const [reviewDueAt, setReviewDueAt] = useState("");
  const [unpublishReason, setUnpublishReason] = useState("");

  const call = async (fn: () => Promise<unknown>, reset?: () => void) => {
    setActionError(null);
    try {
      await fn();
      reset?.();
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return (
      <MuiAlert severity="error">
        Could not load article {id}: {error}
      </MuiAlert>
    );
  }
  if (!article) {
    return <Typography color="text.secondary">Loading...</Typography>;
  }

  const startEdit = () =>
    setEdit({
      title: article.title,
      body: article.body,
      ownerId: article.ownerId ?? "",
    });

  return (
    <Box>
      <Link component={RouterLink} to="/knowledge" sx={{ display: "inline-block", mb: 2 }}>
        ← Knowledge base
      </Link>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h5">{article.title}</Typography>
            <Chip label={`v${article.version}`} />
            <Chip
              label={article.approvalState}
              color={article.approvalState === "APPROVED" ? "success" : "default"}
            />
            {article.reviewOverdue && <Chip color="warning" label="review overdue" />}
            {article.authoritative && <Chip color="info" label="authoritative" />}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Owner: {article.ownerId ?? "—"} · Review due:{" "}
            {article.reviewDueAt ? new Date(article.reviewDueAt).toLocaleDateString() : "—"}
          </Typography>
          <Typography
            variant="body2"
            component="pre"
            sx={{ whiteSpace: "pre-wrap", fontFamily: "inherit", m: 0 }}
          >
            {article.body}
          </Typography>
        </CardContent>
      </Card>

      {actionError && (
        <MuiAlert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </MuiAlert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="h6">Edit</Typography>
              {!edit && (
                <Button size="small" onClick={startEdit}>
                  Edit
                </Button>
              )}
            </Stack>
            {edit && (
              <Stack spacing={2} sx={{ mt: 2 }}>
                <MuiAlert severity="info">
                  Changing title or body bumps the version and reverts the article to DRAFT — it
                  will need re-approval.
                </MuiAlert>
                <TextField
                  size="small"
                  label="Title"
                  value={edit.title}
                  onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                />
                <TextField
                  size="small"
                  multiline
                  minRows={6}
                  label="Body (Markdown)"
                  value={edit.body}
                  onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                />
                <TextField
                  size="small"
                  label="Owner user id"
                  value={edit.ownerId}
                  onChange={(e) => setEdit({ ...edit, ownerId: e.target.value })}
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    onClick={() =>
                      call(
                        () =>
                          apiPatch(`/knowledge/${id}`, {
                            title: edit.title,
                            body: edit.body,
                            ownerId: edit.ownerId || undefined,
                          }),
                        () => setEdit(null),
                      )
                    }
                  >
                    Save
                  </Button>
                  <Button onClick={() => setEdit(null)}>Cancel</Button>
                </Stack>
              </Stack>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          {article.approvalState === "APPROVED" ? (
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Unpublish
              </Typography>
              <Stack spacing={2}>
                <TextField
                  size="small"
                  multiline
                  label="Reason (e.g. found unsafe)"
                  value={unpublishReason}
                  onChange={(e) => setUnpublishReason(e.target.value)}
                />
                <Button
                  variant="contained"
                  color="warning"
                  disabled={unpublishReason.length < 3}
                  onClick={() =>
                    call(
                      () => apiPost(`/knowledge/${id}/unpublish`, { reason: unpublishReason }),
                      () => setUnpublishReason(""),
                    )
                  }
                >
                  Unpublish (back to draft)
                </Button>
              </Stack>
            </Paper>
          ) : (
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                Approve
              </Typography>
              <Stack spacing={2}>
                <TextField
                  size="small"
                  label="Approver (reviewer) user id"
                  value={approverId}
                  onChange={(e) => setApproverId(e.target.value)}
                  helperText="Must not be the article owner"
                />
                <TextField
                  type="date"
                  size="small"
                  label="Next review due"
                  InputLabelProps={{ shrink: true }}
                  value={reviewDueAt}
                  onChange={(e) => setReviewDueAt(e.target.value)}
                />
                <Button
                  variant="contained"
                  disabled={!approverId || !reviewDueAt}
                  onClick={() =>
                    call(
                      () =>
                        apiPost(`/knowledge/${id}/approve`, {
                          approverId,
                          reviewDueAt: new Date(reviewDueAt).toISOString(),
                        }),
                      () => {
                        setApproverId("");
                        setReviewDueAt("");
                      },
                    )
                  }
                >
                  Approve as authoritative
                </Button>
              </Stack>
            </Paper>
          )}
        </Grid>
      </Grid>
    </Box>
  );
}
