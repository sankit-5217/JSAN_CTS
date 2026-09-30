import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
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
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import { apiDelete, apiGet, apiPost } from "../api/client";

interface CategoryTeam {
  id: string;
  category: string;
  groupId: string;
  groupName: string;
}

interface SupportGroup {
  id: string;
  name: string;
}

/**
 * Category -> owning team (GET/POST/DELETE /routing/category-teams). Routing
 * offers a category's tickets to that team's qualified engineers first and
 * records the team on the ticket when someone accepts. Write gate mirrors
 * the backend's ROUTING_POLICY_WRITE_ROLES — UI-only; the backend re-checks.
 */
export function CategoryTeamsCard({ canWrite }: { canWrite: boolean }) {
  const [mappings, setMappings] = useState<CategoryTeam[] | null>(null);
  const [groups, setGroups] = useState<SupportGroup[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      apiGet<CategoryTeam[]>("/routing/category-teams"),
      apiGet<SupportGroup[]>("/support-groups"),
    ])
      .then(([m, g]) => {
        setMappings(m);
        setGroups(g);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  useEffect(load, [load]);

  const add = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await apiPost("/routing/category-teams", { category: category.trim(), groupId });
      setCategory("");
      setGroupId("");
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setActionError(null);
    try {
      await apiDelete(`/routing/category-teams/${id}`);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <GroupsOutlinedIcon color="primary" />
        <Typography variant="h6">Category → owning team</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Tickets in a category are offered to that team&apos;s qualified engineers first, and the
        team is recorded on the ticket when someone accepts. If nobody from the team is on shift,
        other qualified engineers are offered it instead.
      </Typography>

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load team mappings: {loadError}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {canWrite && (
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ mb: 2 }}
          alignItems={{ xs: "stretch", sm: "flex-start" }}
        >
          <TextField
            size="small"
            label="Category"
            placeholder="STORAGE_FAILURE, NETWORK…"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <TextField
            select
            size="small"
            label="Owning team"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            sx={{ minWidth: 200 }}
            helperText={groups.length === 0 ? "Create a support group first" : undefined}
          >
            {groups.map((g) => (
              <MenuItem key={g.id} value={g.id}>
                {g.name}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="outlined"
            onClick={add}
            disabled={busy || !category.trim() || !groupId}
            sx={{ mt: { sm: 0.25 } }}
          >
            {busy ? "Adding…" : "Add"}
          </Button>
        </Stack>
      )}

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Category</TableCell>
              <TableCell>Owning team</TableCell>
              {canWrite && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {mappings === null && !loadError && (
              <TableRow>
                <TableCell colSpan={canWrite ? 3 : 2}>
                  <Typography variant="body2" color="text.secondary">
                    Loading…
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {mappings?.map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.category}</TableCell>
                <TableCell>
                  <Chip size="small" icon={<GroupsOutlinedIcon />} label={m.groupName} />
                </TableCell>
                {canWrite && (
                  <TableCell align="right">
                    <Button size="small" color="error" onClick={() => remove(m.id)}>
                      Remove
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {mappings?.length === 0 && (
              <TableRow>
                <TableCell colSpan={canWrite ? 3 : 2}>
                  <Typography variant="body2" color="text.secondary">
                    No categories mapped to a team yet. Routing considers every qualified engineer.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
