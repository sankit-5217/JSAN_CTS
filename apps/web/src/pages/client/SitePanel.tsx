import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Link,
  Popover,
  Stack,
  Typography,
} from "@mui/material";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import PhoneOutlinedIcon from "@mui/icons-material/PhoneOutlined";
import {
  DUTY_LABEL,
  SITE_STATE_COLOR,
  SITE_STATE_LABEL,
  type PortalContact,
  type PortalSite,
  type PortalTeamMember,
} from "./clientPortal";

/**
 * One site as the customer sees it: whether anything is open there, how to
 * reach the service desk by phone or email, and who is on duty right now.
 */
export function SitePanel({ site }: { site: PortalSite }) {
  return (
    <Card elevation={0} sx={{ borderRadius: 3, border: "1px solid", borderColor: "divider" }}>
      <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography sx={{ fontWeight: 700, mr: 0.5 }}>{site.name}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
            {site.code}
          </Typography>
          <Chip
            size="small"
            color={SITE_STATE_COLOR[site.state]}
            label={SITE_STATE_LABEL[site.state]}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {site.openIssues === 0
            ? "Nothing is open with the service desk for this site."
            : `${site.openIssues} open ${site.openIssues === 1 ? "issue" : "issues"} being handled at this site.`}
        </Typography>

        <Divider sx={{ my: 2 }} />

        <SiteContacts contacts={site.contacts} />

        <Divider sx={{ my: 2 }} />

        <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
          On duty now
        </Typography>
        {site.team.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No engineer is scheduled at this site right now. The service desk still receives
            everything you report.
          </Typography>
        ) : (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {site.team.map((member, i) => (
              <TeamMemberChip key={`${member.name}-${i}`} member={member} />
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

/** Call / email buttons for a site's service desk contacts. */
export function SiteContacts({ contacts }: { contacts: PortalContact[] }) {
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
        Contact the service desk
      </Typography>
      {contacts.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No phone or email is set up for this site yet. Report an issue or reply on a ticket and
          the service desk will see it straight away.
        </Typography>
      ) : (
        <Stack spacing={1.25}>
          {contacts.map((c, i) => (
            <Stack
              key={`${c.name}-${i}`}
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              <Box sx={{ flex: 1, minWidth: 160 }}>
                <Typography component="div" variant="body2" sx={{ fontWeight: 600 }}>
                  {c.name}
                  {c.isOnCall && (
                    <Chip size="small" label="On call" color="info" sx={{ ml: 1, height: 20 }} />
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {c.role}
                </Typography>
              </Box>
              {c.phone && (
                <Button
                  size="small"
                  variant="outlined"
                  href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}
                  startIcon={<PhoneOutlinedIcon />}
                  sx={{ textTransform: "none" }}
                >
                  Call {c.phone}
                </Button>
              )}
              {c.email && (
                <Button
                  size="small"
                  variant="outlined"
                  href={`mailto:${c.email}`}
                  startIcon={<EmailOutlinedIcon />}
                  sx={{ textTransform: "none" }}
                >
                  Email
                </Button>
              )}
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}

function TeamMemberChip({ member }: { member: PortalTeamMember }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const busy = member.tickets.length > 0;
  return (
    <>
      <Chip
        clickable
        onClick={(e) => setAnchor(e.currentTarget)}
        color={busy ? "primary" : "default"}
        variant={busy ? "filled" : "outlined"}
        label={`${member.name} · ${DUTY_LABEL[member.duty]}${busy ? ` · ${member.tickets.length} of yours` : ""}`}
      />
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ p: 2, maxWidth: 320 }}>
          <Typography sx={{ fontWeight: 700 }}>{member.name}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {DUTY_LABEL[member.duty]} · {member.shiftLabel}
          </Typography>
          {busy ? (
            <Stack spacing={0.75}>
              <Typography variant="caption" color="text.secondary">
                Handling your {member.tickets.length === 1 ? "ticket" : "tickets"}:
              </Typography>
              {member.tickets.map((t) => (
                <Link
                  key={t.id}
                  component={RouterLink}
                  to={`/client/tickets/${t.id}`}
                  variant="body2"
                  sx={{ overflowWrap: "anywhere" }}
                >
                  {t.incidentNo}: {t.shortDescription}
                </Link>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2">
              Not handling any of your open tickets right now.
            </Typography>
          )}
        </Box>
      </Popover>
    </>
  );
}
