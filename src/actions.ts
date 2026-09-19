/**
 * Server Action helpers.
 *
 * Every helper returns a discriminated result rather than throwing, because a value
 * returned from a Server Action is serialized across the RSC boundary and an SDK
 * error class does not survive it.
 */

import type { CreatePostInput, Post, UpdatePostInput, UploadedMedia } from '@fopost/sdk';
import { getFoPostClient, type FoPostClientOptions } from './client.js';
import { toSerializableError, type FoPostActionResult } from './errors.js';
import { revalidateFoPost, type FoPostRevalidateTargets } from './cache.js';

/** Shared options for the action factories below. */
export interface FoPostActionOptions extends FoPostClientOptions {
  /** Cache to drop after the action succeeds. */
  revalidate?: FoPostRevalidateTargets;
}

/**
 * Wraps any server-side call so failures come back as `{ ok: false, error }` with a
 * plain-object error. Use it for endpoints this package does not wrap.
 *
 * ```ts
 * 'use server';
 * export const listLabels = createFoPostAction((fopost, workspaceId: string) =>
 *   fopost.labels.list({ workspaceId }),
 * );
 * ```
 */
export function createFoPostAction<Args extends unknown[], T>(
  fn: (fopost: ReturnType<typeof getFoPostClient>, ...args: Args) => Promise<T>,
  options: FoPostActionOptions = {},
): (...args: Args) => Promise<FoPostActionResult<T>> {
  return async (...args: Args): Promise<FoPostActionResult<T>> => {
    try {
      const data = await fn(getFoPostClient(options), ...args);
      if (options.revalidate) await revalidateFoPost(options.revalidate);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: toSerializableError(error) };
    }
  };
}

/** Builds a `create post` Server Action. */
export function createPostAction(
  options: FoPostActionOptions = {},
): (input: CreatePostInput) => Promise<FoPostActionResult<Post>> {
  return createFoPostAction(
    (fopost, input: CreatePostInput) => fopost.posts.create(input),
    options,
  );
}

/** Builds an `update post` Server Action. */
export function updatePostAction(
  options: FoPostActionOptions = {},
): (id: string, input: UpdatePostInput) => Promise<FoPostActionResult<Post>> {
  return createFoPostAction(
    (fopost, id: string, input: UpdatePostInput) => fopost.posts.update(id, input),
    options,
  );
}

/** Builds a `publish post` Server Action. Resolves once delivery is queued. */
export function publishPostAction(
  options: FoPostActionOptions = {},
): (id: string) => Promise<FoPostActionResult<unknown>> {
  return createFoPostAction((fopost, id: string) => fopost.posts.publish(id), options);
}

/** Builds a `delete post` Server Action. */
export function deletePostAction(
  options: FoPostActionOptions = {},
): (id: string) => Promise<FoPostActionResult<void>> {
  return createFoPostAction((fopost, id: string) => fopost.posts.delete(id), options);
}

/**
 * Builds an `upload media` Server Action that takes a form submission.
 *
 * The form carries `workspaceId` and a `file` entry; the bytes go straight from the
 * server to storage through `media.uploadDirect`.
 *
 * ```tsx
 * <form action={uploadMedia}>
 *   <input type="hidden" name="workspaceId" value={WORKSPACE_ID} />
 *   <input type="file" name="file" />
 * </form>
 * ```
 */
export function uploadMediaAction(
  options: FoPostActionOptions = {},
): (formData: FormData) => Promise<FoPostActionResult<UploadedMedia>> {
  return createFoPostAction((fopost, formData: FormData) => {
    const workspaceId = formData.get('workspaceId');
    const file = formData.get('file');
    if (typeof workspaceId !== 'string' || workspaceId === '') {
      throw new TypeError('workspaceId is required');
    }
    if (!(file instanceof Blob)) throw new TypeError('file is required');
    return fopost.media.uploadDirect({
      workspaceId,
      filename: file instanceof File ? file.name : 'upload',
      mimeType: file.type || 'application/octet-stream',
      data: file,
    });
  }, options);
}
