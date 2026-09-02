module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: { project: "tsconfig.json", sourceType: "module" },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  root: true,
  env: { node: true },
  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
  },
};
