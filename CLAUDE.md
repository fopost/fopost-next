# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## What This Is

`@fopost/next` on npm — the official Next.js integration for the FoPost API. It is a **thin
wrapper** around `@fopost/sdk` (npm, sibling repo `fopost-js`). HTTP, retries, models, resource
namespaces and error classes all live in the parent SDK. This package adds only Next.js wiring:
a server-only memoized client, a webhook Route Handler, Server Action helpers, and cache tags.

**Never reimplement API logic here.** If a change means writing a request, a retry, a model or an
error class, it belongs in `fopost-js`, not in this repo.

## Brand Rules

- The product is **FoPost** (`fopost.com`). Never write "OwlStack" — retired Aug 2026.
- Never write an email address. Support is https://fopost.com/contact and GitHub issues.
- Never name AI providers/models, infrastructure vendors, or any person.

## The Server-Only Boundary

This is the reason the package exists, and it is not negotiable.

- `src/client.ts` imports `server-only` as its first statement. It is the only module that
  constructs a `FoPost` instance. `src/index.ts` re-exports it, so the whole entry point is
  server-only and bundling it into a Client Component is a build error.
- The API key is read from `FOPOST_API_KEY` and nothing else. **Never add a `NEXT_PUBLIC_*`
  fallback**, never accept a key through a client-callable argument, never log it.
- Anything new that touches the key goes behind `getFoPostClient()`. If a feature needs to run in
  the browser, it calls a Server Action, not the client.
- Server Action return values cross the RSC boundary and are serialized. Never throw or return a
  `FoPostError` instance from one — route it through `toSerializableError` in `src/errors.ts`.

## Architecture

| File                   | Role                                                                           |
| ---------------------- | ------------------------------------------------------------------------------ |
| `src/client.ts`        | `server-only`. `getFoPostClient()`, memoized per resolved credentials          |
| `src/errors.ts`        | `toSerializableError`, `FoPostActionResult` — the plain-object error shape     |
| `src/cache.ts`         | `foPostTags` and `revalidateFoPost` (lazy `next/cache` import)                 |
| `src/webhook.ts`       | Signature verification and `createFoPostWebhookHandler` for the App Router     |
| `src/webhook-pages.ts` | `createFoPostWebhookApiRoute` + `foPostWebhookApiConfig` for the Pages Router  |
| `src/actions.ts`       | `createFoPostAction` and the per-resource Server Action factories              |
| `src/index.ts`         | The single public entry. Also re-exports `FoPost`, `FoPostError` and SDK types |

Memoization: a module-level `Map` keyed on `baseUrl + apiKey`, wrapped in React `cache()` when it
is available. The map is what actually guarantees a stable instance — React `cache` calls through
uncached outside a request scope, and `cache` is absent on React < 18.3, hence the `typeof` guard.

`next/cache` is imported dynamically inside `revalidateFoPost` so every module stays importable
outside a Next runtime. Do not hoist that import.

## API Contract

Owned by the parent SDK; repeated here only where this package depends on it.

- Base URL `https://api.fopost.com`, paths under `/v1/`. Override with `FOPOST_BASE_URL`.
- Auth header is `X-API-Key: <key>`, never `Bearer`.
- Success envelope `{"data": ...}`; error envelope `{"error": "<code>", "message": "<text>"}`.
  402 may carry `upgrade_url`.
- Retries (429, 5xx, network; exponential backoff) are the SDK's job. Do not add a retry here.

### Webhook signature scheme (verified against the API source)

The API (`fopost/apps/api/src/workers/webhook.worker.ts` and
`services/webhook-dispatcher.ts`) POSTs `JSON.stringify({ event, data, timestamp })` with:

```
X-FoPost-Signature: sha256=<lowercase hex HMAC-SHA256 of the raw body, keyed by the webhook secret>
X-FoPost-Event:     <event name>
X-FoPost-Delivery:  <BullMQ job id>
```

There is **no timestamp in the signed string** and no versioned `t=,v1=` scheme — the HMAC covers
the raw body alone. Verify before parsing: `JSON.parse` then `JSON.stringify` changes the bytes
and the signature will not match. Compare with `crypto.timingSafeEqual` on equal-length buffers,
returning false on a length mismatch rather than throwing.

Events (`WEBHOOK_EVENTS` in `apps/api/src/handlers/webhooks.ts`): `post.published`, `post.failed`,
`post.partially_failed`, `delivery.published`, `delivery.failed`, `delivery.delayed`,
`account.health_changed`. Keep `FOPOST_WEBHOOK_EVENTS` in `src/webhook.ts` in sync with that list.

## Parent Dependency

`@fopost/sdk` is published on npm and declared as a normal `dependencies` entry, so CI resolves it
from the registry with no shim. The constraint is `^0.3.0`, the first release with the `inbox` and
`ads` resources. On a `0.x` version a caret range stays within the minor, so `^0.2` would not pick
it up.

`next` and `react` are peer dependencies (`^14 || ^15` and `^18.2 || ^19`) and dev dependencies, so
CI can typecheck against them without forcing a version on consumers.

## Commands

```bash
npm install
npm run typecheck    # tsc --noEmit  (also aliased as `npm run lint`)
npm test             # vitest run, fully offline
npm run build        # tsup -> dist/ (ESM + CJS + .d.ts)
npm run format       # prettier --write .
npm run format:check
```

Tests stub `globalThis.fetch` and never touch the network. `server-only` throws when imported
outside a React Server layer, so `vitest.config.ts` aliases it to `test/stubs/server-only.ts`;
Next does the equivalent per compiler layer. The SDK binds `globalThis.fetch` once per client
instance, so stub `fetch` **before** the first `getFoPostClient()` call and use
`resetFoPostClientCache()` between tests.

## Conventions

- Prettier: single quotes, semicolons, trailing commas, 100 char width, 2-space indent.
- TypeScript strict, `noUnusedLocals`/`noUnusedParameters`, ESM. Relative imports carry a `.js`
  suffix on `.ts` source.
- Doc comments on exported symbols. Inline comments only for a non-obvious "why", one line.
- `src/index.ts` lists every export explicitly — no `export *` from local modules — so the public
  surface is reviewable in one file.

## Releasing

Tag `v<version>` matching `package.json`; `.github/workflows/release.yml` publishes to npm.
It mirrors `fopost-js/.github/workflows/release.yml` exactly so both packages release the same way:
`id-token: write` for npm **provenance**, `npm publish --access public --provenance`, authenticated
with the repo secret **`NPM_TOKEN`**. Not OIDC trusted publishing — the parent does not use it, and
matching the parent is the requirement. If `fopost-js` moves to trusted publishing, move this one in
the same pass.

The workflow verifies the tag matches `package.json`, runs typecheck/test/build, smoke-tests the
packed tarball under `--conditions=react-server` (both ESM and CJS), asserts the `server-only`
guard still throws without that condition, and skips publishing if the version already exists.

`.github/workflows/ci.yml` runs install, typecheck, test, build and format check on Node 20 and 22.

## Git

Conventional Commits, atomic. Branch `feature/<description>`, merge to `main` via PR.
Never `gh pr create` — push the branch and hand over the compare link.
