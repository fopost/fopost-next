import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FOPOST_API_KEY_ENV,
  FOPOST_BASE_URL_ENV,
  FoPostConfigurationError,
  getFoPostClient,
  resetFoPostClientCache,
} from '../src/index.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resetFoPostClientCache();
  delete process.env[FOPOST_API_KEY_ENV];
  delete process.env[FOPOST_BASE_URL_ENV];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('getFoPostClient', () => {
  it('returns the same instance for the same credentials', () => {
    process.env[FOPOST_API_KEY_ENV] = 'fp_test_key';
    expect(getFoPostClient()).toBe(getFoPostClient());
  });

  it('memoizes per credentials, not globally', () => {
    const a = getFoPostClient({ apiKey: 'fp_a' });
    const b = getFoPostClient({ apiKey: 'fp_b' });
    expect(a).not.toBe(b);
    expect(getFoPostClient({ apiKey: 'fp_a' })).toBe(a);
  });

  it('keys the memo on the base URL too', () => {
    const a = getFoPostClient({ apiKey: 'fp_a' });
    const b = getFoPostClient({ apiKey: 'fp_a', baseUrl: 'https://api.example.test' });
    expect(a).not.toBe(b);
  });

  it('throws a configuration error when no key is available', () => {
    expect(() => getFoPostClient()).toThrow(FoPostConfigurationError);
  });

  it('never reads a NEXT_PUBLIC_ variable for the key', () => {
    process.env.NEXT_PUBLIC_FOPOST_API_KEY = 'fp_leaked';
    expect(() => getFoPostClient()).toThrow(FoPostConfigurationError);
  });

  it('sends the key as X-API-Key against the configured base URL', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    process.env[FOPOST_API_KEY_ENV] = 'fp_test_key';
    process.env[FOPOST_BASE_URL_ENV] = 'https://api.example.test';

    await getFoPostClient().workspaces.list();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // The SDK owns the version prefix; assert the host it was given and the
    // resource it asked for, not the prefix in between.
    expect(url).toMatch(/^https:\/\/api\.example\.test\//);
    expect(url).toMatch(/\/workspaces$/);
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('fp_test_key');
  });
});
