import { Navigate, Link as RouterLink } from "react-router-dom";
import { Box, Button, Card, CardContent } from "@mui/material";
import { getStoredToken } from "../api/client";
import { getCurrentUserRole, passwordChangeRequired } from "../api/jwt";
import { SendingEmailSetup } from "../components/SendingEmailSetup";

export function SendingEmailPage() {
  if (!getStoredToken()) return <Navigate to="/login" replace />;
  if (passwordChangeRequired()) return <Navigate to="/auth/change-password" replace />;
  return (
    <Box sx={{ maxWidth: 700, mx: "auto", p: { xs: 2, sm: 4 } }}>
      <Button
        component={RouterLink}
        to={getCurrentUserRole() === "CLIENT_MANAGER_VIEWER" ? "/client/home" : "/"}
      >
        Continue to OpsDesk
      </Button>
      <Card sx={{ mt: 2 }}>
        <CardContent>
          {/* Reconnects started here come back to this page; connections
              started at sign-in go to the user's own home. */}
          <SendingEmailSetup next="/account/email" />
        </CardContent>
      </Card>
    </Box>
  );
}
