import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Grid,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { apiDelete, apiGet, apiPost } from "../api/client";
import { getCurrentUserRole } from "../api/jwt";

// Mirrors SupportGroupsController's SUPPORT_GROUP_WRITE_ROLES — UI-only gate
// (same pattern as SlaPoliciesPage); backend re-checks this regardless.
const SUPPORT_GROUP_WRITE_ROLES = ["SUPER_ADMIN", "DELIVERY_OPS_MANAGER"];

interface SupportGroup {
  id: string;
  name: string;
  createdAt: string;
}

interface Member {
  membershipId: string;
  id: string;
  displayName: string;
  email: string;
  role: string;
}

/**
 * Support group roster admin — the missing piece behind assigning an
 * incident's ownerGroupId: without members here, a group assignment
 * satisfied the NEW -> ASSIGNED gate but notified no one
 * (IncidentsService.notifyGroupAssignment reads exactly this roster).
 */
export function SupportGroupsPage() {
  const canWrite = SUPPORT_GROUP_WRITE_ROLES.includes(getCurrentUserRole() ?? "");

  const [groups, setGroups] = useState<SupportGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refetchGroups = useCallback(() => {
    setError(null);
    apiGet<SupportGroup[]>("/support-groups")
      .then((res) => {
        setGroups(res);
        setSelectedGroupId((current) => current ?? res[0]?.id ?? null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    refetchGroups();
  }, [refetchGroups]);

  const refetchMembers = useCallback(() => {
    if (!selectedGroupId) {
      setMembers([]);
      return;
    }
    apiGet<Member[]>(`/support-groups/${selectedGroupId}/members`)
      .then(setMembers)
      .catch((err: Error) => setActionError(err.message));
  }, [selectedGroupId]);

  useEffect(() => {
    refetchMembers();
  }, [refetchMembers]);

  // --- Create group -------------------------------------------------------
  const [newGroupName, setNewGroupName] = useState("");

  const createGroup = async () => {
    setActionError(null);
    try {
      const group = await apiPost<SupportGroup>("/support-groups", { name: newGroupName });
      setNewGroupName("");
      refetchGroups();
      setSelectedGroupId(group.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Add member ----------------------------------------------------------
  // No role filter beyond excluding customers — a group's roster can mix
  // Service Desk, engineers, whoever actually covers that queue. The
  // backend rejects a CLIENT_MANAGER_VIEWER id regardless; filtering it out
  // here too just avoids ever offering an option that would be rejected.
  const [memberQuery, setMemberQuery] = useState("");
  const [memberOptions, setMemberOptions] = useState<Member[]>([]);
  const [selectedNewMember, setSelectedNewMember] = useState<Member | null>(null);

  useEffect(() => {
    const qParam = memberQuery ? `&q=${encodeURIComponent(memberQuery)}` : "";
    apiGet<Member[]>(`/users?limit=50${qParam}`)
      .then((res) => setMemberOptions(res.filter((u) => u.role !== "CLIENT_MANAGER_VIEWER")))
      .catch(() => undefined);
  }, [memberQuery]);

  const addMember = async () => {
    if (!selectedGroupId || !selectedNewMember) return;
    setActionError(null);
    try {
      await apiPost(`/support-groups/${selectedGroupId}/members`, {
        userId: selectedNewMember.id,
      });
      setSelectedNewMember(null);
      setMemberQuery("");
      refetchMembers();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeMember = async (userId: string) => {
    if (!selectedGroupId) return;
    setActionError(null);
    try {
      await apiDelete(`/support-groups/${selectedGroupId}/members/${userId}`);
      refetchMembers();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Delete group ---------------------------------------------------------
  const deleteGroup = async () => {
    if (!selectedGroup) return;
    if (
      !window.confirm(
        `Delete "${selectedGroup.name}"? This removes its roster too. Groups with incidents still assigned to them can't be deleted.`,
      )
    ) {
      return;
    }
    setActionError(null);
    try {
      await apiDelete(`/support-groups/${selectedGroup.id}`);
      setSelectedGroupId(null);
      refetchGroups();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 2 }}>
        Support Groups
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Who's on each queue an incident can be assigned to — without a roster here, assigning a
        ticket to a group satisfies the assignment rule but pages nobody.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load support groups: {error}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Groups
            </Typography>
            <List dense disablePadding>
              {groups.map((g) => (
                <ListItemButton
                  key={g.id}
                  selected={g.id === selectedGroupId}
                  onClick={() => setSelectedGroupId(g.id)}
                  sx={{ borderRadius: 1, mb: 0.5 }}
                >
                  <ListItemText primary={g.name} />
                </ListItemButton>
              ))}
              {groups.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No support groups yet.
                </Typography>
              )}
            </List>
          </Paper>

          {canWrite && (
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>
                New group
              </Typography>
              <Stack spacing={2}>
                <TextField
                  size="small"
                  label="Name"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                />
                <Button
                  variant="contained"
                  disabled={newGroupName.trim().length < 2}
                  onClick={createGroup}
                >
                  Create group
                </Button>
              </Stack>
            </Paper>
          )}
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 2 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="h6" gutterBottom>
                {selectedGroup ? `${selectedGroup.name} — members` : "Select a group"}
              </Typography>
              {selectedGroup && canWrite && (
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteOutlineIcon fontSize="small" />}
                  onClick={deleteGroup}
                >
                  Delete group
                </Button>
              )}
            </Stack>
            {selectedGroup && (
              <>
                <Stack spacing={1} sx={{ mb: 2 }}>
                  {members.map((m) => (
                    <Stack
                      key={m.membershipId}
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{
                        py: 0.75,
                        px: 1,
                        borderRadius: 1,
                        border: "1px solid",
                        borderColor: "divider",
                      }}
                    >
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2">{m.displayName}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {m.email}
                        </Typography>
                      </Box>
                      <Chip size="small" label={m.role} variant="outlined" />
                      {canWrite && (
                        <IconButton size="small" onClick={() => removeMember(m.id)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  ))}
                  {members.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No members yet — assigning an incident here won't notify anyone until
                      someone's added.
                    </Typography>
                  )}
                </Stack>

                {canWrite && (
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <Autocomplete
                      sx={{ flex: 1 }}
                      options={memberOptions.filter((o) => !members.some((m) => m.id === o.id))}
                      getOptionLabel={(o) => `${o.displayName} (${o.email})`}
                      isOptionEqualToValue={(o, v) => o.id === v.id}
                      value={selectedNewMember}
                      onChange={(_, value) => setSelectedNewMember(value)}
                      inputValue={memberQuery}
                      onInputChange={(_, value) => setMemberQuery(value)}
                      openOnFocus
                      noOptionsText="No matching staff"
                      renderInput={(params) => (
                        <TextField {...params} label="Add a member" size="small" />
                      )}
                    />
                    <Button
                      variant="contained"
                      disabled={!selectedNewMember}
                      onClick={addMember}
                      sx={{ mt: 0.25 }}
                    >
                      Add
                    </Button>
                  </Stack>
                )}
              </>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}
