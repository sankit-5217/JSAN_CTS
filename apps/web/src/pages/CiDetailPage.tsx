import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { apiGet, apiPatch, apiPost } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";

// Mirrors CisController's CMDB_WRITE_ROLES — UI-only gate (plan Decision 1),
// same list as CisPage.tsx.
const CMDB_WRITE_ROLES = [
  "SUPER_ADMIN",
  "DELIVERY_OPS_MANAGER",
  "INFRASTRUCTURE_LEAD",
  "SITE_ENGINEER",
];
const CRITICALITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const LIFECYCLE_STATUSES = ["PLANNED", "ACTIVE", "MAINTENANCE", "RETIRED"];
// Matches CreateCiRelationDto's CI_RELATION_TYPES (cmdb/dto/create-ci-relation.dto.ts).
const RELATION_TYPES = ["CONTAINS", "DEPENDS_ON", "RUNS_ON", "USES"];
const DIRECTIONS = ["PARENT", "CHILD"] as const;

interface ConfigurationItem {
  id: string;
  ciCode: string;
  siteId: string;
  rackId: string | null;
  ciType: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialOrServiceTag: string | null;
  managementAddress: string | null;
  ownerGroupId: string | null;
  managedBy: string;
  criticality: string;
  lifecycleStatus: string;
}

interface CiRelation {
  id: string;
  parentCiId: string;
  childCiId: string;
  relationType: string;
}

interface CiOption {
  id: string;
  ciCode: string;
  name: string;
}

/**
 * CI workspace (admin-UI-gaps plan, Step 2) — the only place PATCH /cis/:id
 * and both relations endpoints are reachable from. Same parallel-fetch,
 * refetch-on-write shape as IncidentDetailPage.tsx.
 */
export function CiDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ci, setCi] = useState<ConfigurationItem | null>(null);
  const [relations, setRelations] = useState<CiRelation[]>([]);
  const [relatedCis, setRelatedCis] = useState<Record<string, CiOption>>({});
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canWrite = CMDB_WRITE_ROLES.includes(getCurrentUserRole() ?? "");

  const refetch = useCallback(() => {
    if (!id) return;
    setError(null);
    Promise.all([
      apiGet<ConfigurationItem>(`/cis/${id}`),
      apiGet<CiRelation[]>(`/cis/${id}/relations`),
    ])
      .then(([ciData, rels]) => {
        setCi(ciData);
        setRelations(rels);
        const otherIds = Array.from(
          new Set(rels.map((r) => (r.parentCiId === id ? r.childCiId : r.parentCiId))),
        );
        Promise.all(otherIds.map((otherId) => apiGet<CiOption>(`/cis/${otherId}`)))
          .then((cis) => setRelatedCis(Object.fromEntries(cis.map((c) => [c.id, c]))))
          .catch(() => undefined); // non-fatal — falls back to showing raw IDs
      })
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // --- Edit form -----------------------------------------------------------
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    manufacturer: "",
    model: "",
    serialOrServiceTag: "",
    managementAddress: "",
    ownerGroupId: "",
    criticality: "",
    lifecycleStatus: "",
  });

  const startEdit = () => {
    if (!ci) return;
    setEditForm({
      name: ci.name,
      manufacturer: ci.manufacturer ?? "",
      model: ci.model ?? "",
      serialOrServiceTag: ci.serialOrServiceTag ?? "",
      managementAddress: ci.managementAddress ?? "",
      ownerGroupId: ci.ownerGroupId ?? "",
      criticality: ci.criticality,
      lifecycleStatus: ci.lifecycleStatus,
    });
    setEditing(true);
  };

  const submitEdit = async () => {
    if (!id) return;
    setActionError(null);
    try {
      await apiPatch(`/cis/${id}`, {
        ...editForm,
        manufacturer: editForm.manufacturer || undefined,
        model: editForm.model || undefined,
        serialOrServiceTag: editForm.serialOrServiceTag || undefined,
        managementAddress: editForm.managementAddress || undefined,
        ownerGroupId: editForm.ownerGroupId || undefined,
      });
      setEditing(false);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Add relation form -----------------------------------------------------
  const [relatedQuery, setRelatedQuery] = useState("");
  const [relatedOptions, setRelatedOptions] = useState<CiOption[]>([]);
  const [selectedRelated, setSelectedRelated] = useState<CiOption | null>(null);
  const [relationType, setRelationType] = useState(RELATION_TYPES[0]);
  const [direction, setDirection] = useState<(typeof DIRECTIONS)[number]>("CHILD");

  useEffect(() => {
    if (!relatedQuery) {
      setRelatedOptions([]);
      return;
    }
    apiGet<{ items: CiOption[] }>(`/cis?q=${encodeURIComponent(relatedQuery)}`)
      .then((res) => setRelatedOptions(res.items.filter((c) => c.id !== id)))
      .catch(() => undefined);
  }, [relatedQuery, id]);

  const submitRelation = async () => {
    if (!id || !selectedRelated) return;
    setActionError(null);
    try {
      await apiPost(`/cis/${id}/relations`, {
        relatedCiId: selectedRelated.id,
        relationType,
        direction,
      });
      setSelectedRelated(null);
      setRelatedQuery("");
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return (
      <Alert severity="error">
        Could not load CI {id}: {error}
      </Alert>
    );
  }
  if (!ci) {
    return <Typography color="text.secondary">Loading...</Typography>;
  }

  return (
    <Box>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h5">{ci.ciCode}</Typography>
            <Chip label={ci.ciType} />
            <Chip label={ci.criticality} />
            <Chip label={ci.lifecycleStatus} />
          </Stack>
          <Typography variant="body1" sx={{ mb: 1 }}>
            {ci.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {ci.manufacturer ?? "—"} · {ci.model ?? "—"} · serial {ci.serialOrServiceTag ?? "—"}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Managed by {ci.managedBy} · management address {ci.managementAddress ?? "—"} · owner
            group {ci.ownerGroupId ?? "unassigned"}
          </Typography>
          {canWrite && !editing && (
            <Button sx={{ mt: 2 }} variant="outlined" onClick={startEdit}>
              Edit
            </Button>
          )}
        </CardContent>
      </Card>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <Grid container spacing={3}>
        {canWrite && editing && (
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 2, mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                Edit CI
              </Typography>
              <Stack spacing={2}>
                <TextField
                  label="Name"
                  size="small"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
                <TextField
                  label="Manufacturer"
                  size="small"
                  value={editForm.manufacturer}
                  onChange={(e) => setEditForm({ ...editForm, manufacturer: e.target.value })}
                />
                <TextField
                  label="Model"
                  size="small"
                  value={editForm.model}
                  onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                />
                <TextField
                  label="Serial / service tag"
                  size="small"
                  value={editForm.serialOrServiceTag}
                  onChange={(e) => setEditForm({ ...editForm, serialOrServiceTag: e.target.value })}
                />
                <TextField
                  label="Management address"
                  size="small"
                  value={editForm.managementAddress}
                  onChange={(e) => setEditForm({ ...editForm, managementAddress: e.target.value })}
                />
                <TextField
                  label="Owner group ID (UUID)"
                  size="small"
                  value={editForm.ownerGroupId}
                  onChange={(e) => setEditForm({ ...editForm, ownerGroupId: e.target.value })}
                />
                <TextField
                  select
                  label="Criticality"
                  size="small"
                  value={editForm.criticality}
                  onChange={(e) => setEditForm({ ...editForm, criticality: e.target.value })}
                >
                  {CRITICALITIES.map((c) => (
                    <MenuItem key={c} value={c}>
                      {c}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Lifecycle status"
                  size="small"
                  value={editForm.lifecycleStatus}
                  onChange={(e) => setEditForm({ ...editForm, lifecycleStatus: e.target.value })}
                >
                  {LIFECYCLE_STATUSES.map((l) => (
                    <MenuItem key={l} value={l}>
                      {l}
                    </MenuItem>
                  ))}
                </TextField>
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" onClick={submitEdit}>
                    Save
                  </Button>
                  <Button onClick={() => setEditing(false)}>Cancel</Button>
                </Stack>
              </Stack>
            </Paper>
          </Grid>
        )}

        <Grid item xs={12} md={canWrite && editing ? 6 : 12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Relations
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {relations.map((r) => {
                const isParent = r.parentCiId === id;
                const otherId = isParent ? r.childCiId : r.parentCiId;
                const other = relatedCis[otherId];
                return (
                  <Box key={r.id}>
                    <Typography variant="body2">
                      {isParent ? "→" : "←"} {r.relationType} —{" "}
                      {other ? `${other.ciCode} (${other.name})` : otherId}
                    </Typography>
                    <Divider sx={{ mt: 1 }} />
                  </Box>
                );
              })}
              {relations.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No relations yet.
                </Typography>
              )}
            </Stack>

            {canWrite && (
              <Stack spacing={2}>
                <Autocomplete
                  options={relatedOptions}
                  getOptionLabel={(o) => `${o.ciCode} — ${o.name}`}
                  value={selectedRelated}
                  onChange={(_, value) => setSelectedRelated(value)}
                  inputValue={relatedQuery}
                  onInputChange={(_, value) => setRelatedQuery(value)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Related CI (search by code or name)"
                      size="small"
                    />
                  )}
                />
                <TextField
                  select
                  label="Relation type"
                  size="small"
                  value={relationType}
                  onChange={(e) => setRelationType(e.target.value)}
                >
                  {RELATION_TYPES.map((t) => (
                    <MenuItem key={t} value={t}>
                      {t}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="This CI is the..."
                  size="small"
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as (typeof DIRECTIONS)[number])}
                >
                  {DIRECTIONS.map((d) => (
                    <MenuItem key={d} value={d}>
                      {d === "PARENT"
                        ? "Parent (owns the related CI)"
                        : "Child (belongs to the related CI)"}
                    </MenuItem>
                  ))}
                </TextField>
                <Button variant="contained" disabled={!selectedRelated} onClick={submitRelation}>
                  Add relation
                </Button>
              </Stack>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
