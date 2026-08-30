/**
 * Pages Router variant of the webhook handler.
 *
 * The Pages Router parses the body before the handler runs, which destroys the bytes
 * the signature covers. The route file must therefore re-export
 * {@link foPostWebhookApiConfig} so Next hands over the raw stream.
 */

import type { IncomingMessage } from 'node:http';
import {
  FOPOST_DELIVERY_HEADER,
  FOPOST_EVENT_HEADER,
  FOPOST_SIGNATURE_HEADER,
  createFoPostWebhookHandler,
  type CreateFoPostWebhookHandlerOptions,
} from './webhook.js';

/**
 * ```ts
 * // pages/api/fopost/webhook.ts
 * export const config = foPostWebhookApiConfig;
 * ```
 */
export const foPostWebhookApiConfig = { api: { bodyParser: false } } as const;

/** Structurally compatible with `NextApiRequest`, without depending on Next's types. */
export type FoPostApiRequest = IncomingMessage & {
  method?: string;
  headers: IncomingMessage['headers'];
};

/** Structurally compatible with `NextApiResponse`. */
export interface FoPostApiResponse {
  status(code: number): FoPostApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

/** Max bytes accepted before the request is rejected. */
const MAX_BODY_BYTES = 1_000_000;

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error('FoPost webhook body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Builds a Pages Router API route handler. Same options as the App Router version.
 * Pair it with `export const config = foPostWebhookApiConfig`.
 */
export function createFoPostWebhookApiRoute(
  options: CreateFoPostWebhookHandlerOptions = {},
): (req: FoPostApiRequest, res: FoPostApiResponse) => Promise<void> {
  const handler = createFoPostWebhookHandler(options);

  return async function foPostWebhookApiRoute(req, res): Promise<void> {
    if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ error: 'method_not_allowed', message: 'Use POST.' });
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readRawBody(req);
    } catch {
      res.status(413).json({ error: 'payload_too_large', message: 'Body exceeds the limit.' });
      return;
    }

    const headers = new Headers({ 'content-type': 'application/json' });
    for (const name of [FOPOST_SIGNATURE_HEADER, FOPOST_EVENT_HEADER, FOPOST_DELIVERY_HEADER]) {
      const value = headerValue(req.headers[name]);
      if (value) headers.set(name, value);
    }

    const response = await handler(
      new Request('https://fopost.invalid/webhook', { method: 'POST', headers, body: rawBody }),
    );

    res.status(response.status).json(await response.json());
  };
}
