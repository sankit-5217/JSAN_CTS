module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    // .ts only: compiled .js from workspace deps (e.g. the monitoring adapters,
    // resolved via symlink outside node_modules) must load as plain CJS, not be
    // re-fed to ts-jest.
    "^.+\\.ts$": "ts-jest",
  },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  testEnvironment: "node",
};
