import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectUploadInput } from '@fopost/sdk';
import {
  FOPOST_API_KEY_ENV,
  createFoPostAction,
  createPostAction,
  publishPostAction,
  resetFoPostClientCache,
  uploadMediaAction,
} from '../src/index.js';

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  resetFoPostClientCache();
  process.env[FOPOST_API_KEY_ENV] = 'fp_test_key';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

const INPUT = {
  workspaceId: 'w_1',
  content: [{ text: 'Hello from a Server Action' }],
  accounts: ['a_1'],
};

describe('Server Action helpers', () => {
  it('returns { ok: true, data } on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: { id: 'p_1', status: 'draft' } })),
    );

    const result = await createPostAction()(INPUT);
    expect(result).toEqual({ ok: true, data: { id: 'p_1', status: 'draft' } });
  });

  it('returns a serializable error instead of throwing an SDK error class', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: 'validation_failed', message: 'accounts is required' }, 422),
      ),
    );

    const result = await createPostAction()(INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error).toEqual({
      message: 'accounts is required',
      status: 422,
      code: 'validation_failed',
    });
    // No Error instance survives the RSC boundary, so the whole result must clone.
    expect(result.error).not.toBeInstanceOf(Error);
    expect(structuredClone(result)).toEqual(result);
  });

  it('maps a payment-required failure to a serializable 402', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          { error: 'subscription_required', message: 'Upgrade to publish', upgrade_url: 'x' },
          402,
        ),
      ),
    );

    const result = await publishPostAction()('p_1');
    expect(result).toEqual({
      ok: false,
      error: { message: 'Upgrade to publish', status: 402, code: 'subscription_required' },
    });
    expect(structuredClone(result)).toEqual(result);
  });

  it('serializes a transport failure with a null status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const result = await createPostAction()(INPUT);
    expect(result).toEqual({
      ok: false,
      error: { message: 'fetch failed', status: null, code: 'TypeError' },
    });
    expect(structuredClone(result)).toEqual(result);
  });

  it('serializes a missing-API-key configuration failure', async () => {
    delete process.env[FOPOST_API_KEY_ENV];
    const result = await createPostAction()(INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.code).toBe('FoPostConfigurationError');
    expect(result.error.status).toBeNull();
    expect(structuredClone(result)).toEqual(result);
  });

  it('createFoPostAction wraps an arbitrary SDK call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [{ id: 'l_1', name: 'launch' }] })),
    );

    const listLabels = createFoPostAction((fopost, workspaceId: string) =>
      fopost.labels.list({ workspaceId }),
    );

    expect(await listLabels('w_1')).toEqual({ ok: true, data: [{ id: 'l_1', name: 'launch' }] });
  });

  it('revalidates only after a successful call', async () => {
    const revalidateTag = vi.fn();
    const revalidatePath = vi.fn();
    vi.doMock('next/cache', () => ({ revalidateTag, revalidatePath }));

    // The SDK binds globalThis.fetch once per client, so one mock serves both calls.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: 'server_error', message: 'nope' }, 500))
        .mockResolvedValueOnce(jsonResponse({ data: { id: 'p_1' } })),
    );

    const { createPostAction: create } = await import('../src/actions.js');
    const action = create({ revalidate: { tags: ['fopost:posts:w_1'], paths: ['/posts'] } });

    expect((await action(INPUT)).ok).toBe(false);
    expect(revalidateTag).not.toHaveBeenCalled();

    expect((await action(INPUT)).ok).toBe(true);
    expect(revalidateTag).toHaveBeenCalledWith('fopost:posts:w_1');
    expect(revalidatePath).toHaveBeenCalledWith('/posts');

    vi.doUnmock('next/cache');
  });

  it('uploadMediaAction hands the file name, type and bytes to media.uploadDirect', async () => {
    const stored = {
      id: 'm_1',
      type: 'image',
      name: 'logo.png',
      url: 'u',
      previewUrl: 'p',
      size: 3,
    };
    const uploadDirect = vi.fn(async (_input: DirectUploadInput) => stored);
    vi.doMock('../src/client.js', () => ({
      getFoPostClient: () => ({ media: { uploadDirect } }),
    }));

    // actions.js is already cached from the top-level import; drop it so the mock applies.
    vi.resetModules();
    const { uploadMediaAction } = await import('../src/actions.js');
    const formData = new FormData();
    formData.set('workspaceId', 'w_1');
    formData.set('file', new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' }));

    const result = await uploadMediaAction()(formData);

    expect(result).toEqual({ ok: true, data: stored });
    expect(uploadDirect).toHaveBeenCalledTimes(1);
    const input = uploadDirect.mock.calls[0]![0];
    expect(input.workspaceId).toBe('w_1');
    expect(input.filename).toBe('logo.png');
    expect(input.mimeType).toBe('image/png');
    expect(new Uint8Array(await (input.data as Blob).arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    vi.doUnmock('../src/client.js');
    vi.resetModules();
  });

  it('uploadMediaAction fails without a file', async () => {
    const formData = new FormData();
    formData.set('workspaceId', 'w_1');

    const result = await uploadMediaAction()(formData);
    expect(result).toEqual({
      ok: false,
      error: { message: 'file is required', status: null, code: 'TypeError' },
    });
    expect(structuredClone(result)).toEqual(result);
  });
});
