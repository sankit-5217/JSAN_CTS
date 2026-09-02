import { Routes, Route, Link } from "react-router-dom";
import { AppBar, Box, Toolbar, Typography, Button } from "@mui/material";
import { CommandCenterPage } from "./pages/CommandCenterPage";
import { SitesPage } from "./pages/SitesPage";

export function App() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            JSAN CTS Data Center OpsDesk
          </Typography>
          <Button color="inherit" component={Link} to="/">
            Command Center
          </Button>
          <Button color="inherit" component={Link} to="/sites">
            Sites
          </Button>
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ flex: 1, p: 3 }}>
        <Routes>
          <Route path="/" element={<CommandCenterPage />} />
          <Route path="/sites" element={<SitesPage />} />
        </Routes>
      </Box>
    </Box>
  );
}
