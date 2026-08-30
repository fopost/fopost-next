import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  FOPOST_SIGNATURE_HEADER,
  createFoPostWebhookApiRoute,
  foPostWebhookApiConfig,
} from '../src/index.js';
import type { FoPostApiRequest, FoPostApiResponse } from '../src/index.js';

const SECRET = 'whsec_test_secret';

function sign(rawBody: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

function fakeReq(rawBody: string, headers: Record<string, string>, method = 'POST') {
  const stream = Readable.from([Buffer.from(rawBody, 'utf8')]) as unknown as FoPostApiRequest;
  stream.headers = headers;
  stream.method = method;
  return stream;
}

function fakeRes() {
  const state = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const res: FoPostApiResponse = {
    status(code) {
      state.status = code;
      return res;
    },
    json(body) {
      state.body = body;
    },
    setHeader(name, value) {
      state.headers[name] = value;
    },
  };
  return { res, state };
}

const PAYLOAD = JSON.stringify({
  event: 'post.published',
  data: { postId: 'p_1', workspaceId: 'w_1' },
  timestamp: '2026-08-30T10:00:00.000Z',
});

describe('createFoPostWebhookApiRoute', () => {
  it('disables the Pages body parser so the raw bytes survive', () => {
    expect(foPostWebhookApiConfig).toEqual({ api: { bodyParser: false } });
  });

  it('reads the raw stream, verifies it and dispatches', async () => {
    const onPublished = vi.fn();
    const route = createFoPostWebhookApiRoute({
      secret: SECRET,
      on: { 'post.published': onPublished },
    });
    const { res, state } = fakeRes();

    await route(fakeReq(PAYLOAD, { [FOPOST_SIGNATURE_HEADER]: sign(PAYLOAD) }), res);

    expect(state.status).toBe(200);
    expect(state.body).toEqual({ received: true });
    expect(onPublished.mock.calls[0]![0].rawBody).toBe(PAYLOAD);
  });

  it('rejects a bad signature with 401', async () => {
    const onPublished = vi.fn();
    const route = createFoPostWebhookApiRoute({
      secret: SECRET,
      on: { 'post.published': onPublished },
    });
    const { res, state } = fakeRes();

    await route(fakeReq(PAYLOAD, { [FOPOST_SIGNATURE_HEADER]: sign(PAYLOAD, 'wrong') }), res);

    expect(state.status).toBe(401);
    expect(onPublished).not.toHaveBeenCalled();
  });

  it('answers 405 for anything but POST', async () => {
    const route = createFoPostWebhookApiRoute({ secret: SECRET });
    const { res, state } = fakeRes();

    await route(fakeReq('', {}, 'GET'), res);

    expect(state.status).toBe(405);
    expect(state.headers.Allow).toBe('POST');
  });
});
