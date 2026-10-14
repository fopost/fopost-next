/**
 * FoPost webhook verification and App Router `POST` handlers.
 *
 * The API signs the exact bytes it sends:
 *
 *   X-FoPost-Signature:     sha256=<hex HMAC-SHA256 of the raw body, keyed by the secret>
 *   X-FoPost-Timestamp:     <unix seconds>
 *   X-FoPost-Signature-256: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">
 *   X-FoPost-Event:         post.published
 *   X-FoPost-Delivery:      <delivery id>
 *
 * Verification is the SDK's (`verifyWebhookSignature` in `@fopost/sdk`): the timestamped
 * signature is preferred and refused past 300 s; the body-only one is accepted only when no
 * timestamp header is present. The raw body must be verified before it is parsed, since
 * re-serializing parsed JSON changes the bytes the signature covers.
 */

import { createHmac } from 'node:crypto';
import {
  verifyWebhook,
  verifyWebhookSignature,
  WebhookError,
  type ArticlePublishedPayload,
  type WebhookEvent,
} from '@fopost/sdk';
import { revalidateFoPost, foPostTags, type FoPostRevalidateTargets } from './cache.js';

export const FOPOST_SIGNATURE_HEADER = 'x-fopost-signature';
export const FOPOST_TIMESTAMP_HEADER = 'x-fopost-timestamp';
export const FOPOST_TIMESTAMPED_SIGNATURE_HEADER = 'x-fopost-signature-256';
export const FOPOST_EVENT_HEADER = 'x-fopost-event';
export const FOPOST_DELIVERY_HEADER = 'x-fopost-delivery';
export const FOPOST_WEBHOOK_SECRET_ENV = 'FOPOST_WEBHOOK_SECRET';

/** Events the API can deliver. Mirrors `WEBHOOK_EVENTS` on the server. */
export const FOPOST_WEBHOOK_EVENTS = [
  'post.published',
  'post.failed',
  'post.partially_failed',
  'delivery.published',
  'delivery.failed',
  'delivery.delayed',
  'account.health_changed',
  'article.published',
] as const;

export type FoPostWebhookEvent = (typeof FOPOST_WEBHOOK_EVENTS)[number];

/** The delivered envelope. `data` is the event-specific body. */
export interface FoPostWebhookPayload<T = Record<string, unknown>> {
  event: FoPostWebhookEvent;
  data: T;
  timestamp: string;
}

export interface FoPostWebhookContext<T = Record<string, unknown>> {
  event: FoPostWebhookEvent;
  payload: FoPostWebhookPayload<T>;
  /** Value of `X-FoPost-Delivery`, or `null` when the header is absent. */
  deliveryId: string | null;
  /** The verified bytes, exactly as received. */
  rawBody: string;
  request: Request;
}

export type FoPostWebhookHandlerFn<T = Record<string, unknown>> = (
  context: FoPostWebhookContext<T>,
) => void | Promise<void>;

export interface CreateFoPostWebhookHandlerOptions {
  /** Defaults to `process.env.FOPOST_WEBHOOK_SECRET`. */
  secret?: string;
  /** Per-event handlers. `'*'` runs for every event, after the specific one. */
  on?: Partial<Record<FoPostWebhookEvent | '*', FoPostWebhookHandlerFn>>;
  /**
   * Cache to drop after the handlers run. `true` uses a sensible default derived
   * from the event; a function computes targets from the delivery.
   */
  revalidate?:
    | boolean
    | FoPostRevalidateTargets
    | ((context: FoPostWebhookContext) => FoPostRevalidateTargets);
  /** Called when a handler throws. The response is still a 500. */
  onError?: (error: unknown, context: FoPostWebhookContext) => void | Promise<void>;
}

/** Computes the body-only `X-FoPost-Signature` value the API would send for these exact bytes. */
export function signFoPostPayload(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

/** Headers as a `Headers` instance or the plain object Node hands out. */
export type FoPostWebhookHeaders = Headers | Record<string, string | string[] | undefined>;

export interface VerifyFoPostSignatureInput {
  /** The raw request body. Never a re-serialized object. */
  rawBody: string;
  /** The request headers. Carries the timestamped signature, which is preferred. */
  headers?: FoPostWebhookHeaders;
  /** The `X-FoPost-Signature` value alone, when the headers are not at hand. Body-only check. */
  signature?: string | null;
  secret: string;
}

/**
 * Returns true when the delivery verifies. Never throws. Delegates to the SDK: the
 * timestamped signature wins and is refused after 300 s; the body-only signature is the
 * fallback when no timestamp header was sent.
 */
export async function verifyFoPostSignature({
  rawBody,
  headers,
  signature,
  secret,
}: VerifyFoPostSignatureInput): Promise<boolean> {
  if (!secret) return false;
  const source = headers ?? (signature ? { [FOPOST_SIGNATURE_HEADER]: signature.trim() } : {});
  try {
    await verifyWebhookSignature(rawBody, source, secret);
    return true;
  } catch {
    return false;
  }
}

function isWebhookEvent(value: unknown): value is FoPostWebhookEvent {
  return typeof value === 'string' && (FOPOST_WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/** Default cache targets for an event, used when `revalidate: true`. */
export function defaultRevalidateTargets(context: FoPostWebhookContext): FoPostRevalidateTargets {
  const data = context.payload.data as Record<string, unknown>;
  const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : undefined;
  const postId = typeof data?.postId === 'string' ? data.postId : undefined;
  const accountId = typeof data?.accountId === 'string' ? data.accountId : undefined;

  const tags = new Set<string>();
  if (context.event.startsWith('post.') || context.event.startsWith('delivery.')) {
    tags.add(foPostTags.posts(workspaceId));
    if (postId) tags.add(foPostTags.post(postId));
  }
  if (context.event.startsWith('account.')) {
    tags.add(foPostTags.accounts(workspaceId));
    if (accountId) tags.add(foPostTags.account(accountId));
  }
  if (tags.size === 0) tags.add(foPostTags.all());
  return { tags: [...tags] };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function notConfigured(factory: string): Response {
  return json(
    {
      error: 'webhook_not_configured',
      message: `Set ${FOPOST_WEBHOOK_SECRET_ENV} or pass { secret } to ${factory}().`,
    },
    500,
  );
}

async function runRevalidation(
  options: CreateFoPostWebhookHandlerOptions,
  context: FoPostWebhookContext,
): Promise<void> {
  const { revalidate } = options;
  if (!revalidate) return;
  const targets =
    revalidate === true
      ? defaultRevalidateTargets(context)
      : typeof revalidate === 'function'
        ? revalidate(context)
        : revalidate;
  await revalidateFoPost(targets);
}

/**
 * Builds the App Router `POST` handler for a FoPost webhook route.
 *
 * ```ts
 * // app/api/fopost/webhook/route.ts
 * export const POST = createFoPostWebhookHandler({
 *   on: { 'post.published': async ({ payload }) => { ... } },
 * });
 * ```
 */
export function createFoPostWebhookHandler(
  options: CreateFoPostWebhookHandlerOptions = {},
): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    const secret = options.secret ?? process.env[FOPOST_WEBHOOK_SECRET_ENV];
    if (!secret) return notConfigured('createFoPostWebhookHandler');

    // Read the bytes first. Parsing before verifying would defeat the signature.
    const rawBody = await request.text();

    if (!(await verifyFoPostSignature({ rawBody, headers: request.headers, secret }))) {
      return json({ error: 'invalid_signature', message: 'Signature verification failed.' }, 401);
    }

    let payload: FoPostWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as FoPostWebhookPayload;
    } catch {
      return json({ error: 'invalid_payload', message: 'Body is not valid JSON.' }, 400);
    }

    const event = isWebhookEvent(payload?.event)
      ? payload.event
      : (request.headers.get(FOPOST_EVENT_HEADER) as FoPostWebhookEvent | null);
    if (!isWebhookEvent(event)) {
      return json({ error: 'unknown_event', message: 'Missing or unrecognized event.' }, 400);
    }

    const context: FoPostWebhookContext = {
      event,
      payload: { ...payload, event },
      deliveryId: request.headers.get(FOPOST_DELIVERY_HEADER),
      rawBody,
      request,
    };

    try {
      await options.on?.[event]?.(context);
      await options.on?.['*']?.(context);
      await runRevalidation(options, context);
    } catch (error) {
      await options.onError?.(error, context);
      return json({ error: 'handler_failed', message: 'Webhook handler threw.' }, 500);
    }

    return json({ received: true }, 200);
  };
}

export interface ArticleWebhookContext {
  /** Value of `X-FoPost-Delivery`, or `null` when the header is absent. */
  deliveryId: string | null;
  request: Request;
}

export interface ArticleWebhookOptions {
  /** The website secret from the blog settings. Defaults to `process.env.FOPOST_WEBHOOK_SECRET`. */
  secret?: string;
  /** Receives each published article. Return the URL it now lives at to echo it back to FoPost. */
  onArticlePublished: (
    article: ArticlePublishedPayload,
    context: ArticleWebhookContext,
  ) => string | void | Promise<string | void>;
}

/**
 * Builds the App Router `POST` handler a website target delivers articles to.
 * Answers `{ ok: true }` to `article.test` and hands `article.published` to the callback.
 *
 * ```ts
 * // app/api/fopost/articles/route.ts
 * export const POST = articleWebhook({
 *   onArticlePublished: async (article) => `https://yourbrand.com/blog/${article.slug}`,
 * });
 * ```
 */
export function articleWebhook(
  options: ArticleWebhookOptions,
): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    const secret = options.secret ?? process.env[FOPOST_WEBHOOK_SECRET_ENV];
    if (!secret) return notConfigured('articleWebhook');

    const rawBody = await request.text();
    let envelope: WebhookEvent;
    try {
      envelope = await verifyWebhook(rawBody, request.headers, secret);
    } catch (error) {
      if (error instanceof WebhookError && error.code === 'invalid_body') {
        return json({ error: 'invalid_payload', message: 'Body is not valid JSON.' }, 400);
      }
      return json({ error: 'invalid_signature', message: 'Signature verification failed.' }, 401);
    }

    if (envelope.event === 'article.test') return json({ ok: true }, 200);
    if (envelope.event !== 'article.published') {
      return json({ error: 'unknown_event', message: 'Missing or unrecognized event.' }, 400);
    }

    try {
      const url = await options.onArticlePublished(envelope.data as ArticlePublishedPayload, {
        deliveryId: request.headers.get(FOPOST_DELIVERY_HEADER),
        request,
      });
      return json(typeof url === 'string' ? { url } : { ok: true }, 200);
    } catch {
      return json({ error: 'handler_failed', message: 'Webhook handler threw.' }, 500);
    }
  };
}
