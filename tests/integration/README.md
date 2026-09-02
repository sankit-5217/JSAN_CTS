# Integration tests

Cross-module tests against a real (test-env) Postgres/Redis/MinIO, per spec
§21: Postgres repositories, Redis jobs, object storage, event ingestion,
vendor adapter mocks. Prefer `apps/api/src/**/*.spec.ts` for module-local
unit tests; put here only tests that span multiple modules or infra.
