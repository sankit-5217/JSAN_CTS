/**
 * End-to-end config: boots the real Nest app (AppModule) over an HTTP socket
 * and drives it with supertest. Kept separate from the unit `jest.config.js`
 * (which is `rootDir: src`, no DB) — run with `pnpm test:e2e`.
 *
 * Needs a Postgres reachable at $DATABASE_URL. `test/env.js` redirects that to
 * an isolated `e2e` schema so a run never touches dev data; `test/setup-e2e.ts`
 * truncates + reseeds that schema before each file.
 */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "..",
  testRegex: "test/.*\\.e2e-spec\\.ts$",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/test/tsconfig.json" }] },
  testEnvironment: "node",
  // env.js runs before anything imports PrismaClient / @nestjs/config
  setupFiles: ["<rootDir>/test/env.js"],
  setupFilesAfterEnv: ["<rootDir>/test/setup-e2e.ts"],
  testTimeout: 30_000,
  // one worker: all files share the single e2e schema
  maxWorkers: 1,
};
