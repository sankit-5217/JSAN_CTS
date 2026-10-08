import { Box, Button, Card, CardContent, Chip, Divider, Stack, Typography } from "@mui/material";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import PhoneOutlinedIcon from "@mui/icons-material/PhoneOutlined";
import {
  SITE_STATE_COLOR,
  SITE_STATE_LABEL,
  type PortalContact,
  type PortalSite,
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
