import { useCallback } from "react";
import { Navigate, Link as RouterLink, useNavigate } from "react-router-dom";
import { Box, Button, Card, CardContent } from "@mui/material";
import { getStoredToken } from "../api/client";
import { getCurrentUserRole, passwordChangeRequired } from "../api/jwt";
import { SendingEmailSetup } from "../components/SendingEmailSetup";
import { sendingMailReturnPath } from "../api/sendingMail";

export function SendingEmailPage() {
  const navigate = useNavigate();
  const next = sendingMailReturnPath(getCurrentUserRole());
  const continueToOpsDesk = useCallback(() => navigate(next, { replace: true }), [navigate, next]);
  if (!getStoredToken()) return <Navigate to="/login" replace />;
  if (passwordChangeRequired()) return <Navigate to="/auth/change-password" replace />;
  return (
    <Box sx={{ maxWidth: 700, mx: "auto", p: { xs: 2, sm: 4 } }}>
      <Button component={RouterLink} to={next}>
        Continue to OpsDesk
      </Button>
      <Card sx={{ mt: 2 }}>
        <CardContent>
          <SendingEmailSetup next={next} onContinue={continueToOpsDesk} />
        </CardContent>
      </Card>
    </Box>
  );
}
