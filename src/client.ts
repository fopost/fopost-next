import 'server-only';

import { cache } from 'react';
import { FoPost } from '@fopost/sdk';

/**
 * Options for {@link getFoPostClient}. Every field falls back to an environment
 * variable, so the common case is calling `getFoPostClient()` with no arguments.
 */
export interface FoPostClientOptions {
  /** Defaults to `process.env.FOPOST_API_KEY`. Never a `NEXT_PUBLIC_*` variable. */
  apiKey?: string;
  /** Defaults to `process.env.FOPOST_BASE_URL`, then the SDK default. */
  baseUrl?: string;
}

export const FOPOST_API_KEY_ENV = 'FOPOST_API_KEY';
export const FOPOST_BASE_URL_ENV = 'FOPOST_BASE_URL';

/** Thrown when the API key cannot be resolved from options or the environment. */
export class FoPostConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FoPostConfigurationError';
  }
}

const clients = new Map<string, FoPost>();

function buildClient(apiKey: string, baseUrl: string | undefined): FoPost {
  const key = `${baseUrl ?? ''} ${apiKey}`;
  let client = clients.get(key);
  if (!client) {
    client = new FoPost({ apiKey, ...(baseUrl ? { baseUrl } : {}) });
    clients.set(key, client);
  }
  return client;
}

// React `cache` dedupes within a request; the module map keeps the instance stable
// across requests and outside a request scope. `cache` is absent on React < 18.3.
const memoizedBuildClient = typeof cache === 'function' ? cache(buildClient) : buildClient;

/**
 * The server-only FoPost client, memoized per resolved credentials.
 *
 * Safe to call from a Server Component, a Route Handler, or a Server Action. The
 * `server-only` import above makes bundling this module into a Client Component a
 * build error, so the API key can never reach the browser.
 */
export function getFoPostClient(options: FoPostClientOptions = {}): FoPost {
  const apiKey = options.apiKey ?? process.env[FOPOST_API_KEY_ENV];
  if (!apiKey) {
    throw new FoPostConfigurationError(
      `Missing FoPost API key. Set ${FOPOST_API_KEY_ENV} in your server environment ` +
        'or pass { apiKey } to getFoPostClient(). Never use a NEXT_PUBLIC_ variable for it.',
    );
  }
  const baseUrl = options.baseUrl ?? process.env[FOPOST_BASE_URL_ENV];
  return memoizedBuildClient(apiKey, baseUrl);
}

/** Drops every memoized client. Intended for tests. */
export function resetFoPostClientCache(): void {
  clients.clear();
}
