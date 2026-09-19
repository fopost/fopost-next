/**
 * @fopost/next — the official Next.js integration for the FoPost API.
 *
 * A thin wrapper around `@fopost/sdk`. Every request, retry, model and error class
 * lives in the SDK; this package only wires it into Next.js idioms.
 *
 * This entry point is SERVER-ONLY. It pulls in `server-only`, so importing it from a
 * Client Component is a build error and `FOPOST_API_KEY` can never reach the browser.
 *
 *   // app/page.tsx (Server Component)
 *   import { getFoPostClient } from '@fopost/next';
 *   const workspaces = await getFoPostClient().workspaces.list();
 */

export {
  getFoPostClient,
  resetFoPostClientCache,
  FoPostConfigurationError,
  FOPOST_API_KEY_ENV,
  FOPOST_BASE_URL_ENV,
  type FoPostClientOptions,
} from './client.js';

export {
  toSerializableError,
  type FoPostActionResult,
  type FoPostSerializableError,
} from './errors.js';

export {
  foPostTags,
  revalidateFoPost,
  FOPOST_TAG_PREFIX,
  type FoPostRevalidateTargets,
} from './cache.js';

export {
  createFoPostWebhookHandler,
  verifyFoPostSignature,
  signFoPostPayload,
  defaultRevalidateTargets,
  FOPOST_WEBHOOK_EVENTS,
  FOPOST_SIGNATURE_HEADER,
  FOPOST_EVENT_HEADER,
  FOPOST_DELIVERY_HEADER,
  FOPOST_WEBHOOK_SECRET_ENV,
  type CreateFoPostWebhookHandlerOptions,
  type FoPostWebhookContext,
  type FoPostWebhookEvent,
  type FoPostWebhookHandlerFn,
  type FoPostWebhookPayload,
  type VerifyFoPostSignatureInput,
} from './webhook.js';

export {
  createFoPostWebhookApiRoute,
  foPostWebhookApiConfig,
  type FoPostApiRequest,
  type FoPostApiResponse,
} from './webhook-pages.js';

export {
  createFoPostAction,
  createPostAction,
  updatePostAction,
  publishPostAction,
  deletePostAction,
  uploadMediaAction,
  type FoPostActionOptions,
} from './actions.js';

// The full API surface — resources, DTOs and FoPostError — comes from the SDK.
export { FoPost, FoPostError } from '@fopost/sdk';
export type * from '@fopost/sdk';
