import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { apiPost, storeToken } from "../api/client";

interface DevLoginResponse {
  accessToken: string;
}

// Matches apps/api/prisma/seed.ts's seeded users — a convenience dropdown,
// not a hard-coded allowlist (any active user's email works via dev-login).
const SEEDED_USERS = [
  { email: "admin@example.com", label: "admin@example.com (SUPER_ADMIN, all sites)" },
  { email: "servicedesk@example.com", label: "servicedesk@example.com (SERVICE_DESK_NOC, SITE01)" },
  { email: "engineer1@example.com", label: "engineer1@example.com (SITE_ENGINEER, SITE01)" },
  { email: "engineer@example.com", label: "engineer@example.com (SITE_ENGINEER, SITE02)" },
];

/**
 * Dev-mode login (Sprint 7 plan, Decision 4) — wraps the existing
 * `POST /auth/dev-login` (server-side disabled outside dev/local) behind a
 * real UI instead of a browser-console snippet. Real OIDC login is a
 * separate, later piece of work; this page goes away once that lands.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(SEEDED_USERS[0].email);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await apiPost<DevLoginResponse>("/auth/dev-login", { email });
      storeToken(accessToken);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Card sx={{ minWidth: 360 }}>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            JSAN CTS Data Center OpsDesk
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Dev-mode sign-in — picks a seeded user, no password. Disabled server-side outside
            local/dev.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Sign-in failed: {error}
            </Alert>
          )}

          <TextField
            select
            fullWidth
            label="User"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            sx={{ mb: 2 }}
          >
            {SEEDED_USERS.map((user) => (
              <MenuItem key={user.email} value={user.email}>
                {user.label}
              </MenuItem>
            ))}
          </TextField>

          <Button variant="contained" fullWidth disabled={loading} onClick={handleLogin}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
