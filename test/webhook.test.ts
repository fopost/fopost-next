import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  FOPOST_DELIVERY_HEADER,
  FOPOST_SIGNATURE_HEADER,
  createFoPostWebhookHandler,
  signFoPostPayload,
  verifyFoPostSignature,
} from '../src/index.js';

const SECRET = 'whsec_test_secret';

function sign(rawBody: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

function post(rawBody: string, headers: Record<string, string> = {}): Request {
  return new Request('https://app.example.test/api/fopost/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: rawBody,
  });
}

const PAYLOAD = JSON.stringify({
  event: 'post.published',
  data: { postId: 'p_1', workspaceId: 'w_1' },
  timestamp: '2026-08-30T10:00:00.000Z',
});

describe('verifyFoPostSignature', () => {
  it('matches the scheme the API uses: sha256=<hex hmac of the raw body>', () => {
    expect(signFoPostPayload(PAYLOAD, SECRET)).toBe(sign(PAYLOAD));
    expect(
      verifyFoPostSignature({ rawBody: PAYLOAD, signature: sign(PAYLOAD), secret: SECRET }),
    ).toBe(true);
  });

  it('returns false rather than throwing on a missing or malformed signature', () => {
    expect(verifyFoPostSignature({ rawBody: PAYLOAD, signature: null, secret: SECRET })).toBe(
      false,
    );
    expect(verifyFoPostSignature({ rawBody: PAYLOAD, signature: 'garbage', secret: SECRET })).toBe(
      false,
    );
    expect(verifyFoPostSignature({ rawBody: PAYLOAD, signature: sign(PAYLOAD), secret: '' })).toBe(
      false,
    );
  });

  it('rejects a signature made with a different secret', () => {
    expect(
      verifyFoPostSignature({
        rawBody: PAYLOAD,
        signature: sign(PAYLOAD, 'other'),
        secret: SECRET,
      }),
    ).toBe(false);
  });
});

describe('createFoPostWebhookHandler', () => {
  it('rejects a bad signature with 401 and never runs a handler', async () => {
    const onPublished = vi.fn();
    const handler = createFoPostWebhookHandler({
      secret: SECRET,
      on: { 'post.published': onPublished },
    });

    const res = await handler(post(PAYLOAD, { [FOPOST_SIGNATURE_HEADER]: sign(PAYLOAD, 'wrong') }));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'invalid_signature' });
    expect(onPublished).not.toHaveBeenCalled();
  });

  it('rejects a missing signature header with 401', async () => {
    const handler = createFoPostWebhookHandler({ secret: SECRET });
    expect((await handler(post(PAYLOAD))).status).toBe(401);
  });

  it('accepts a good signature and dispatches to the event handler', async () => {
    const onPublished = vi.fn();
    const onFailed = vi.fn();
    const handler = createFoPostWebhookHandler({
      secret: SECRET,
      on: { 'post.published': onPublished, 'post.failed': onFailed },
    });

    const res = await handler(
      post(PAYLOAD, {
        [FOPOST_SIGNATURE_HEADER]: sign(PAYLOAD),
        [FOPOST_DELIVERY_HEADER]: 'dlv_42',
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(onFailed).not.toHaveBeenCalled();
    expect(onPublished).toHaveBeenCalledOnce();

    const context = onPublished.mock.calls[0]![0];
    expect(context.event).toBe('post.published');
    expect(context.payload.data).toEqual({ postId: 'p_1', workspaceId: 'w_1' });
    expect(context.deliveryId).toBe('dlv_42');
    expect(context.rawBody).toBe(PAYLOAD);
  });

  it('runs the wildcard handler after the specific one', async () => {
    const order: string[] = [];
    const handler = createFoPostWebhookHandler({
      secret: SECRET,
      on: {
        'post.published': () => void order.push('specific'),
        '*': () => void order.push('wildcard'),
      },
    });

    await handler(post(PAYLOAD, { [FOPOST_SIGNATURE_HEADER]: sign(PAYLOAD) }));
    expect(order).toEqual(['specific', 'wildcard']);
  });

  it('verifies the raw bytes, so re-serializing the JSON would not have matched', async () => {
    // Same object, different bytes: key order and whitespace differ from PAYLOAD.
    const raw =
      '{\n  "timestamp": "2026-08-30T10:00:00.000Z",\n  "data": {"postId": "p_1"},\n  "event": "post.published"\n}';
    const reserialized = JSON.stringify(JSON.parse(raw));
    expect(reserialized).not.toBe(raw);

    const onPublished = vi.fn();
    const handler = createFoPostWebhookHandler({
      secret: SECRET,
      on: { 'post.published': onPublished },
    });

    // A signature over the bytes actually sent is accepted.
    const good = await handler(post(raw, { [FOPOST_SIGNATURE_HEADER]: sign(raw) }));
    expect(good.status).toBe(200);
    expect(onPublished.mock.calls[0]![0].rawBody).toBe(raw);

    // A signature over the re-serialized form is not, proving the check is on raw bytes.
    onPublished.mockClear();
    const bad = await handler(post(raw, { [FOPOST_SIGNATURE_HEADER]: sign(reserialized) }));
    expect(bad.status).toBe(401);
    expect(onPublished).not.toHaveBeenCalled();
  });

  it('returns 400 for a signed body that is not JSON', async () => {
    const raw = 'not json';
    const handler = createFoPostWebhookHandler({ secret: SECRET });
    const res = await handler(post(raw, { [FOPOST_SIGNATURE_HEADER]: sign(raw) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_payload' });
  });

  it('returns 400 for a signed body with an unrecognized event', async () => {
    const raw = JSON.stringify({ event: 'post.exploded', data: {}, timestamp: 'now' });
    const handler = createFoPostWebhookHandler({ secret: SECRET });
    const res = await handler(post(raw, { [FOPOST_SIGNATURE_HEADER]: sign(raw) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unknown_event' });
  });

  it('returns 500 and reports when a handler throws', async () => {
    const onError = vi.fn();
    const handler = createFoPostWebhookHandler({
      secret: SECRET,
      on: {
        'post.published': () => {
          throw new Error('boom');
        },
      },
      onError,
    });

    const res = await handler(post(PAYLOAD, { [FOPOST_SIGNATURE_HEADER]: sign(PAYLOAD) }));
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('returns 500 when no secret is configured', async () => {
    const handler = createFoPostWebhookHandler({});
    const res = await handler(post(PAYLOAD, { [FOPOST_SIGNATURE_HEADER]: sign(PAYLOAD) }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'webhook_not_configured' });
  });

  it('invokes the revalidation bridge with the computed targets', async () => {
    const revalidateTag = vi.fn();
    const revalidatePath = vi.fn();
    vi.doMock('next/cache', () => ({ revalidateTag, revalidatePath }));

    const { createFoPostWebhookHandler: create } = await import('../src/webhook.js');
    const handler = create({ secret: SECRET, revalidate: true });

    const res = await handler(post(PAYLOAD, { [FOPOST_SIGNATURE_HEADER]: sign(PAYLOAD) }));
    expect(res.status).toBe(200);
    expect(revalidateTag.mock.calls.flat()).toEqual(
      expect.arrayContaining(['fopost:posts:w_1', 'fopost:post:p_1']),
    );

    vi.doUnmock('next/cache');
  });
});
