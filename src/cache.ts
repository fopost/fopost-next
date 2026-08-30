/**
 * Cache tags for FoPost reads, plus the `next/cache` revalidation bridge a webhook
 * uses to refresh them.
 */

export const FOPOST_TAG_PREFIX = 'fopost';

/** Canonical cache tags. Pass them to `fetch(..., { next: { tags } })`. */
export const foPostTags = {
  /** Everything FoPost. Revalidating this drops every tag below. */
  all: (): string => FOPOST_TAG_PREFIX,
  workspaces: (): string => `${FOPOST_TAG_PREFIX}:workspaces`,
  workspace: (workspaceId: string): string => `${FOPOST_TAG_PREFIX}:workspace:${workspaceId}`,
  posts: (workspaceId?: string): string =>
    workspaceId ? `${FOPOST_TAG_PREFIX}:posts:${workspaceId}` : `${FOPOST_TAG_PREFIX}:posts`,
  post: (postId: string): string => `${FOPOST_TAG_PREFIX}:post:${postId}`,
  accounts: (workspaceId?: string): string =>
    workspaceId ? `${FOPOST_TAG_PREFIX}:accounts:${workspaceId}` : `${FOPOST_TAG_PREFIX}:accounts`,
  account: (accountId: string): string => `${FOPOST_TAG_PREFIX}:account:${accountId}`,
  analytics: (workspaceId?: string): string =>
    workspaceId
      ? `${FOPOST_TAG_PREFIX}:analytics:${workspaceId}`
      : `${FOPOST_TAG_PREFIX}:analytics`,
} as const;

/** What to invalidate. Either list is optional. */
export interface FoPostRevalidateTargets {
  tags?: string[];
  paths?: string[];
}

/**
 * Revalidates Next's data and route caches.
 *
 * `next/cache` is imported lazily so this module stays importable outside a Next
 * runtime (tests, scripts).
 */
export async function revalidateFoPost(targets: FoPostRevalidateTargets): Promise<void> {
  const tags = targets.tags ?? [];
  const paths = targets.paths ?? [];
  if (tags.length === 0 && paths.length === 0) return;

  const { revalidateTag, revalidatePath } = await import('next/cache');
  for (const tag of tags) revalidateTag(tag);
  for (const path of paths) revalidatePath(path);
}
