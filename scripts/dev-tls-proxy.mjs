#!/usr/bin/env node
/**
 * Local-only TLS terminator in front of `pnpm dev:api` (plain HTTP).
 *
 * The site collector refuses a non-https `apiBaseUrl` (ADR-004 — outbound
 * TLS only, enforced in apps/collector/src/config.ts's `requireHttps`), so
 * there is no way to point `pnpm dev:collector` at the local dev API without
 * *something* terminating TLS in front of it. This script is that something,
 * for local development only — it is never how a real deployment gets its
 * cert, and it must never run anywhere but a developer's own machine.
 *
 * Generates a throwaway self-signed cert on first run (into ./.dev-tls/,
 * gitignored) and proxies HTTPS -> the given HTTP target. To make the
 * collector process trust that cert, run it with:
 *   NODE_EXTRA_CA_CERTS=<repo>/.dev-tls/cert.pem
 * (a self-signed cert listed there is trusted as its own CA — no need to
 * disable TLS verification).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:https";
import { request } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const certDir = join(__dirname, "..", ".dev-tls");
const keyPath = join(certDir, "key.pem");
const certPath = join(certDir, "cert.pem");

const listenPort = Number(process.env.PORT ?? 8443);
const targetPort = Number(process.env.TARGET_PORT ?? 3000);
const targetHost = process.env.TARGET_HOST ?? "127.0.0.1";

function ensureCert() {
  if (existsSync(keyPath) && existsSync(certPath)) {
    return;
  }
  mkdirSync(certDir, { recursive: true });
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "3650",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);
  console.log(`[dev-tls-proxy] generated a throwaway self-signed cert in ${certDir}`);
}

ensureCert();

const options = { key: readFileSync(keyPath), cert: readFileSync(certPath) };

const server = createServer(options, (req, res) => {
  const proxyReq = request(
    {
      host: targetHost,
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (err) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`dev-tls-proxy: upstream error: ${err instanceof Error ? err.message : String(err)}`);
  });
  req.pipe(proxyReq);
});

server.listen(listenPort, () => {
  console.log(
    `[dev-tls-proxy] https://localhost:${listenPort} -> http://${targetHost}:${targetPort}`,
  );
  console.log(`[dev-tls-proxy] trust it via NODE_EXTRA_CA_CERTS=${certPath}`);
});
