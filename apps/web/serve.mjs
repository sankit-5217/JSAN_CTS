// Production static server for the built web app (Railway "web" service).
// Serves apps/web/dist with an SPA fallback to index.html; no dependencies.
// The API is a separate service — VITE_API_BASE_URL is baked in at build time.
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const port = Number(process.env.PORT) || 5173;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function fileFor(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const full = normalize(join(root, decoded));
  if (full !== root && !full.startsWith(root + sep)) return null; // no path traversal
  try {
    return statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }
  const file = fileFor(req.url ?? "/") ?? join(root, "index.html");
  const hashed = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    "content-type": types[extname(file)] ?? "application/octet-stream",
    // Vite fingerprints /assets/*, so those never change; index.html must always be fresh.
    "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
}).listen(port, "0.0.0.0", () => {
  console.log(`OpsDesk web listening on :${port}`);
});
