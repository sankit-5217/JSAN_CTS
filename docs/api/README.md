# API documentation

The live OpenAPI/Swagger spec is generated from the NestJS DTOs and served
at `/api/docs` when `apps/api` is running (see `apps/api/src/main.ts`).
Export a static copy here (`openapi.json`) as part of the release process
once the API stabilizes past Sprint 4.
