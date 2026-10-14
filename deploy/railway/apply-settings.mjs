// Applies deploy/railway/<service>.json to the linked Railway project's
// services (build/start/pre-deploy/healthcheck settings) via the Railway
// GraphQL API. Railway retired per-service railway.json files, so these JSON
// files are the record of each service's settings and this script applies them.
//
//   railway link            # once, to the jsan-opsdesk project
//   node deploy/railway/apply-settings.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SERVICES = ["api", "worker", "web"];
// NODE_ENV=production is set on every service and would make pnpm skip the
// devDependencies the build needs (nest, tsc, prisma, vite).
const INSTALL_CMD = "pnpm install --frozen-lockfile --prod=false";

// On Windows the npm-installed CLI is a .cmd shim, which needs a shell; quote
// each argument so the GraphQL document stays one argument.
const win = process.platform === "win32";
const railway = (args, input) =>
  execFileSync("railway", win ? args.map((a) => `"${a}"`) : args, {
    encoding: "utf8",
    input,
    shell: win,
  });

const status = JSON.parse(railway(["status", "--json"]));
const env = status.environments.edges.find((e) => e.node.name === "production")?.node;
if (!env) throw new Error("no production environment in the linked project");
const ids = Object.fromEntries(status.services.edges.map((e) => [e.node.name, e.node.id]));

const mutation =
  "mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {" +
  " serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }";

for (const name of SERVICES) {
  if (!ids[name]) throw new Error(`service "${name}" not found in the linked project`);
  const input = JSON.parse(readFileSync(join(here, `${name}.json`), "utf8"));
  const variables = JSON.stringify({ serviceId: ids[name], environmentId: env.id, input });
  railway(["api", mutation, "--variables", "@-", "--compact"], variables);
  railway(["variable", "set", "RAILPACK_INSTALL_CMD", "--stdin", "--service", name, "--skip-deploys"], INSTALL_CMD);
  console.log(`${name}: settings applied`);
}
