# @fopost/next

[![npm](https://img.shields.io/npm/v/%40fopost%2Fnext.svg)](https://www.npmjs.com/package/@fopost/next)
[![license](https://img.shields.io/npm/l/%40fopost%2Fnext.svg)](https://github.com/fopost/fopost-next/blob/main/LICENSE)
[![ci](https://img.shields.io/github/actions/workflow/status/fopost/fopost-next/ci.yml?branch=main&label=ci)](https://github.com/fopost/fopost-next/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/actions/workflow/status/fopost/fopost-next/release.yml?label=release)](https://github.com/fopost/fopost-next/actions/workflows/release.yml)

Official Next.js integration for the [FoPost](https://fopost.com) API. Schedule and publish to +30 social platforms from your app.

This is a **thin wrapper** around [`@fopost/sdk`](https://github.com/fopost/fopost-js). Every request, retry, model and error class lives there; this package only wires FoPost into Next.js idioms — a server-only client, a webhook Route Handler, Server Action helpers, and cache tags.

```bash
npm install @fopost/next
```

Requires Node 20+, Next 14 or 15, and React 18.2+. Ships ESM and CommonJS builds with TypeScript types.

> **0.x release.** The public API is still settling and minor versions may contain breaking changes. Pin an exact version if that matters to you.

## The server-only guarantee

**A FoPost API key must never reach the browser**, and this package enforces that rather than documenting it.

- The module that constructs the client imports [`server-only`](https://www.npmjs.com/package/server-only). Bundling `@fopost/next` into a Client Component is a **build error**, not a runtime surprise.
- The key is read from `FOPOST_API_KEY`. There is no `NEXT_PUBLIC_*` path to it, and `getFoPostClient()` will not fall back to one.
- Call it from a Server Component, a Route Handler, or a Server Action. Pass **data** to Client Components, never the client.

If you see `This module cannot be imported from a Client Component module`, a `'use client'` file is importing `@fopost/next`. Move the call into a Server Action and import that instead.

## Environment

| Variable                | Required | What it does                                               |
| ----------------------- | -------- | ---------------------------------------------------------- |
| `FOPOST_API_KEY`        | yes      | Your API key, sent as `X-API-Key`. Server-side only        |
| `FOPOST_BASE_URL`       | no       | Override the API base URL                                  |
| `FOPOST_WEBHOOK_SECRET` | webhooks | Signing secret of the webhook you created in the dashboard |

Get a key at [app.fopost.com/api-keys](https://app.fopost.com/api-keys).

## Server Component

```tsx
// app/posts/page.tsx
import { getFoPostClient } from '@fopost/next';

export default async function PostsPage() {
  const fopost = getFoPostClient();
  const posts = await fopost.posts.list({ workspaceId: process.env.FOPOST_WORKSPACE_ID! });

  return (
    <ul>
      {posts.map((post) => (
        <li key={post.id}>
          {post.title ?? post.id} — {post.status}
        </li>
      ))}
    </ul>
  );
}
```

`getFoPostClient()` is memoized per resolved credentials, so calling it in every component and action is free.

## Server Actions

Action return values are serialized across the RSC boundary, so an SDK error instance cannot be thrown through one. Every helper returns a discriminated result with a **plain-object** error instead.

```ts
// app/posts/actions.ts
'use server';

import { createPostAction, publishPostAction, foPostTags } from '@fopost/next';

const revalidate = { tags: [foPostTags.posts(WORKSPACE_ID)], paths: ['/posts'] };

const createPost = createPostAction({ revalidate });
const publishPost = publishPostAction({ revalidate });

export async function composeAndPublish(formData: FormData) {
  const created = await createPost({
    workspaceId: WORKSPACE_ID,
    content: [{ text: String(formData.get('text')) }],
    accounts: formData.getAll('accounts').map(String),
  });
  if (!created.ok) return created; // { ok: false, error: { message, status, code } }

  return publishPost(created.data.id);
}
```

```tsx
// app/posts/compose-form.tsx
'use client';
import { composeAndPublish } from './actions';

// The action is imported; the client and the key are not.
<form action={composeAndPublish}>...</form>;
```

| Helper                   | Wraps                    |
| ------------------------ | ------------------------ |
| `createPostAction()`     | `posts.create`           |
| `updatePostAction()`     | `posts.update`           |
| `publishPostAction()`    | `posts.publish`          |
| `deletePostAction()`     | `posts.delete`           |
| `createFoPostAction(fn)` | anything else in the SDK |

Publishing is **create then publish**, and `publish` resolves when delivery is queued, not when the post is live. The `post.published` webhook tells you it landed.

## Webhooks

The API signs the exact bytes it sends:

```
X-FoPost-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed by your webhook secret>
X-FoPost-Event:     post.published
X-FoPost-Delivery:  <delivery id>
```

The handler reads the raw body **before** parsing it, verifies with a constant-time compare, and answers `401` on a mismatch. Re-serializing the parsed JSON would change the bytes and break verification, which is exactly the mistake this helper removes.

```ts
// app/api/fopost/webhook/route.ts
import { createFoPostWebhookHandler } from '@fopost/next';

export const runtime = 'nodejs'; // signature verification uses node:crypto

export const POST = createFoPostWebhookHandler({
  // secret defaults to process.env.FOPOST_WEBHOOK_SECRET
  on: {
    'post.published': async ({ payload, deliveryId }) => {
      await recordPublished(payload.data, deliveryId);
    },
    '*': async ({ event }) => log(event), // runs after the specific handler
  },
  revalidate: true, // drop the cache tags this event affects
  onError: (error) => report(error),
});
```

Events: `post.published`, `post.failed`, `post.partially_failed`, `delivery.published`, `delivery.failed`, `delivery.delayed`, `account.health_changed`.

Responses: `200 {"received":true}` · `401 invalid_signature` · `400 invalid_payload` / `unknown_event` · `500 webhook_not_configured` / `handler_failed`.

`verifyFoPostSignature({ rawBody, signature, secret })` is exported if you want to verify by hand.

### Pages Router

The Pages Router parses the body before your handler runs, which destroys the signed bytes. Re-export the config so Next hands over the raw stream:

```ts
// pages/api/fopost/webhook.ts
import { createFoPostWebhookApiRoute, foPostWebhookApiConfig } from '@fopost/next';

export const config = foPostWebhookApiConfig; // { api: { bodyParser: false } }

export default createFoPostWebhookApiRoute({
  on: { 'post.published': async ({ payload }) => recordPublished(payload.data) },
});
```

## Caching and revalidation

`foPostTags` gives you stable tags to hang FoPost reads on, and the webhook drops them when the API says something changed.

```ts
import { foPostTags, revalidateFoPost } from '@fopost/next';

// Tag a read in a Server Component
await fetch(`${process.env.FOPOST_BASE_URL}/v1/posts?workspace_id=${id}`, {
  headers: { 'X-API-Key': process.env.FOPOST_API_KEY! },
  next: { tags: [foPostTags.posts(id)], revalidate: 60 },
});

// Drop it by hand
await revalidateFoPost({ tags: [foPostTags.posts(id)], paths: ['/posts'] });
```

| Tag                                                    | Covers                  |
| ------------------------------------------------------ | ----------------------- |
| `foPostTags.all()`                                     | everything FoPost       |
| `foPostTags.posts(workspaceId?)`                       | a workspace's post list |
| `foPostTags.post(postId)`                              | one post                |
| `foPostTags.accounts(workspaceId?)`                    | connected accounts      |
| `foPostTags.account(accountId)`                        | one account             |
| `foPostTags.workspaces()` / `foPostTags.workspace(id)` | workspaces              |
| `foPostTags.analytics(workspaceId?)`                   | analytics reads         |

`revalidate: true` on the webhook handler derives the tags from the event; pass an object or a function for full control.

## The rest of the API

Resources, DTOs and `FoPostError` are re-exported from `@fopost/sdk` for convenience:

```ts
import { getFoPostClient, FoPostError } from '@fopost/next';

const fopost = getFoPostClient();
await fopost.accounts.list({ workspaceId });
await fopost.ai.generateCaption({ currentCaption: 'shipping today' });
```

See the [`@fopost/sdk` README](https://github.com/fopost/fopost-js#readme) for the full surface — `posts`, `accounts`, `workspaces`, `labels`, `ai` — plus retries, error handling and the transport contract.

## Examples

[`examples/app-router`](examples/app-router) is a runnable App Router slice: a Server Component read, a Server Action that creates and publishes, the client form that calls it, and the webhook route.

## Contributing

Issues and pull requests are welcome at [fopost/fopost-next](https://github.com/fopost/fopost-next/issues).

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest, fully offline
npm run build       # tsup -> dist/
```

Docs live at [fopost.com/docs](https://fopost.com/docs). For anything else, use the [contact form](https://fopost.com/contact).

## License

MIT © Porter Bridge, LLC
