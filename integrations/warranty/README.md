# @cts-dc-opsdesk/warranty-adapter

Read-only hardware **warranty lookup** behind one interface. Used by the API's
`vendors` module (which owns the `Warranty` table, spec §10.13 / §12) to refresh
coverage state for CIs, and scheduled by `apps/worker`.

## Contract

```ts
interface WarrantyProvider {
  readonly name: string;
  supports(vendor: string): boolean;
  lookup(q: { vendor: string; serialOrServiceTag: string }): Promise<WarrantyLookupResult>;
}

interface WarrantyLookupResult {
  status: "ACTIVE" | "EXPIRED" | "UNKNOWN"; // matches the Prisma WarrantyStatus enum
  provider: string;
  expiresAt?: string; // ISO-8601
  coverageLevel?: string; // informational
}
```

Providers are **read-only** — one outbound lookup, no writes, no side effects
(CLAUDE.md "no destructive hardware actions in v1" extends to vendor systems).

## Providers

| Provider | Enabled when | Notes |
| --- | --- | --- |
| `DellWarrantyProvider` | `DELL_WARRANTY_API_KEY` set | Hits the Dell asset-entitlements endpoint. The OAuth2 client-credentials exchange that mints the token is the caller's responsibility — inject the resulting bearer as `apiKey`. |
| `HpeWarrantyProvider` | `HPE_WARRANTY_API_KEY` set | Hits the HPE product-warranty lookup. |
| `StubWarrantyProvider` | `WARRANTY_STUB=1`, or any non-`production` `NODE_ENV` | Deterministic pseudo-data derived from the service tag. **Never** used in production — an un-mapped vendor is reported as `skipped`, not fabricated. |

`createWarrantyProviders(env)` returns the ordered list (real providers first,
stub last as a catch-all). `resolveWarrantyProvider(list, vendor)` returns the
first entry whose `supports()` matches.

## Normalization

`normalizeDellWarranty` / `normalizeHpeWarranty` are pure: they pick the
entitlement/offer with the latest end date and mark it `ACTIVE` while that date
is in the future, `EXPIRED` once it has passed, `UNKNOWN` when nothing is dated.
Fixture-based contract tests live alongside them.

## Scripts

```bash
pnpm --filter @cts-dc-opsdesk/warranty-adapter test
pnpm --filter @cts-dc-opsdesk/warranty-adapter typecheck
pnpm --filter @cts-dc-opsdesk/warranty-adapter lint
```
