import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid2 as Grid,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import AssignmentIndOutlinedIcon from "@mui/icons-material/AssignmentIndOutlined";
import ChatOutlinedIcon from "@mui/icons-material/ChatOutlined";
import TaskAltOutlinedIcon from "@mui/icons-material/TaskAltOutlined";
import { apiGet, getStoredToken } from "../../api/client";
import { decodeJwtPayload } from "../../api/jwt";
import { isFinished, needsYou } from "./clientTicket";
import { TicketRow, type ClientIncident } from "./MyTicketsPage";
import { useAnsweredResolutions } from "./useAnsweredResolutions";

const HOW_IT_WORKS = [
  {
    icon: <AddCommentOutlinedIcon />,
    title: "1. You report it",
    text: "Describe what you see. Photos help. You get a ticket number straight away.",
  },
  {
    icon: <AssignmentIndOutlinedIcon />,
    title: "2. We triage and assign",
    text: "The service desk sets the priority and assigns the right engineer. You'll see who.",
  },
  {
    icon: <ChatOutlinedIcon />,
    title: "3. We keep you posted",
    text: "Every update lands on the ticket and in your bell. If we need something, we'll ask there.",
  },
  {
    icon: <TaskAltOutlinedIcon />,
    title: "4. You confirm the fix",
    text: "When we mark it resolved, tell us if it's really fixed. Then we close it.",
  },
];

const GOOD_REPORT_TIPS = [
  "Which rack or device, and its label or asset tag if you can see one",
  "What you noticed: lights, alarms, error messages, noises",
  "When it started, and whether anything changed just before",
  "What it's affecting for you right now",
];

/**
 * The client portal's landing page: what needs the customer's attention,
 * how to raise something new, and how working with the service desk goes.
 */
export function ClientHomePage() {
  const [incidents, setIncidents] = useState<ClientIncident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const token = getStoredToken();
  const email = token ? (decodeJwtPayload(token)?.email ?? "") : "";
  const firstName = email.split("@")[0].split(/[._-]/)[0];
  const greetingName = firstName ? firstName[0].toUpperCase() + firstName.slice(1) : "";

  useEffect(() => {
    apiGet<{ items: ClientIncident[] }>("/incidents?limit=200")
      .then((res) => setIncidents(res.items))
      .catch((err: Error) => setError(err.message));
  }, []);

  const answered = useAnsweredResolutions(incidents);

  const { attention, open, closed } = useMemo(() => {
    const all = incidents ?? [];
    return {
      attention: all
        .filter((i) => needsYou(i, answered))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      open: all.filter((i) => !isFinished(i.status)).length,
      closed: all.filter((i) => isFinished(i.status)).length,
    };
  }, [incidents, answered]);

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        {greetingName ? `Hello, ${greetingName}` : "Welcome"}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Report data center issues and work them through with the JSAN service desk.
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            label="Need you"
            value={incidents ? attention.length : "–"}
            to="/client/tickets?show=needs-you"
            highlight={attention.length > 0}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <StatCard label="Open" value={incidents ? open : "–"} to="/client/tickets?show=open" />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <StatCard
            label="Closed"
            value={incidents ? closed : "–"}
            to="/client/tickets?show=closed"
          />
        </Grid>
      </Grid>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Couldn't load your tickets: {error}
        </Alert>
      )}

      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
        Needs your attention
      </Typography>
      {incidents === null && !error && (
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Loading...
        </Typography>
      )}
      {incidents && attention.length === 0 && (
        <Card
          elevation={0}
          sx={{ borderRadius: 3, border: "1px dashed", borderColor: "divider", mb: 3 }}
        >
          <CardContent sx={{ py: 3, textAlign: "center" }}>
            <Typography color="text.secondary">
              You're all caught up. Nothing is waiting on you.
            </Typography>
          </CardContent>
        </Card>
      )}
      <Stack spacing={1.25} sx={{ mb: 4 }}>
        {attention.slice(0, 5).map((inc) => (
          <TicketRow key={inc.id} incident={inc} actionNeeded />
        ))}
        {attention.length > 5 && (
          <Link component={RouterLink} to="/client/tickets?show=needs-you">
            See all {attention.length}
          </Link>
        )}
      </Stack>

      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card
            elevation={0}
            sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider", height: "100%" }}
          >
            <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
              <Typography sx={{ fontWeight: 700, mb: 0.5 }}>Something wrong?</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                A good report gets fixed faster. Try to include:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5, mb: 2 }}>
                {GOOD_REPORT_TIPS.map((t) => (
                  <Typography component="li" variant="body2" key={t} sx={{ mb: 0.5 }}>
                    {t}
                  </Typography>
                ))}
              </Box>
              <Button
                component={RouterLink}
                to="/client/report"
                variant="contained"
                sx={{ textTransform: "none", fontWeight: 600 }}
              >
                Report an issue
              </Button>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card
            elevation={0}
            sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider", height: "100%" }}
          >
            <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
              <Typography sx={{ fontWeight: 700, mb: 0.5 }}>Following up on a ticket?</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Reply on the ticket itself rather than opening a new one. The engineer handling it
                is notified straight away, and the whole history stays in one place.
              </Typography>
              <Button
                component={RouterLink}
                to="/client/tickets"
                variant="outlined"
                sx={{ textTransform: "none", fontWeight: 600 }}
              >
                Go to my tickets
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
        How we work together
      </Typography>
      <Grid container spacing={2}>
        {HOW_IT_WORKS.map((step) => (
          <Grid key={step.title} size={{ xs: 12, sm: 6, md: 3 }}>
            <Card
              elevation={0}
              sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider", height: "100%" }}
            >
              <CardContent>
                <Box sx={{ color: "primary.main", mb: 1 }}>{step.icon}</Box>
                <Typography sx={{ fontWeight: 700, fontSize: 14.5, mb: 0.5 }}>
                  {step.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {step.text}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

function StatCard({
  label,
  value,
  to,
  highlight = false,
}: {
  label: string;
  value: number | string;
  to: string;
  highlight?: boolean;
}) {
  return (
    <Card
      elevation={0}
      component={RouterLink}
      to={to}
      sx={{
        display: "block",
        textDecoration: "none",
        borderRadius: 3,
        border: "1px solid",
        borderColor: highlight ? "warning.main" : "divider",
        "&:hover": { borderColor: highlight ? "warning.dark" : "primary.light" },
      }}
    >
      <CardContent>
        <Typography
          sx={{ fontSize: 28, fontWeight: 800, color: highlight ? "warning.dark" : "text.primary" }}
        >
          {value}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      </CardContent>
    </Card>
  );
}
