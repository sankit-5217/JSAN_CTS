import { useEffect, useState } from "react";
import {
  Alert,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { apiGet } from "../api/client";

interface Site {
  id: string;
  code: string;
  name: string;
  timezone: string;
  is247: boolean;
  status: string;
}

/**
 * Reference screen exercising the sites module end-to-end (API -> Prisma ->
 * UI). Use this as the pattern for CMDB/incident list pages: server-side
 * pagination/sort/filter for large datasets is required once real data
 * volume shows up (spec §19) — this table is a Sprint 1 stub.
 */
export function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Site[]>("/sites")
      .then(setSites)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <>
      <Typography variant="h4" gutterBottom>
        Sites
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load sites: {error}
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Code</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Timezone</TableCell>
              <TableCell>24x7</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sites.map((site) => (
              <TableRow key={site.id}>
                <TableCell>{site.code}</TableCell>
                <TableCell>{site.name}</TableCell>
                <TableCell>{site.timezone}</TableCell>
                <TableCell>{site.is247 ? "Yes" : "No"}</TableCell>
                <TableCell>{site.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
