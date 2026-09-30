import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind every interface, not just localhost, so a teammate on the same
    // LAN can open this dev server too (http://<your-LAN-IP>:5173).
    host: true,
  },
});
