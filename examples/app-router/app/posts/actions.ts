'use server';

import { createPostAction, foPostTags, publishPostAction } from '@fopost/next';
import type { FoPostActionResult } from '@fopost/next';

const WORKSPACE_ID = process.env.FOPOST_WORKSPACE_ID!;

const revalidate = { tags: [foPostTags.posts(WORKSPACE_ID)], paths: ['/posts'] };

const createPost = createPostAction({ revalidate });
const publishPost = publishPostAction({ revalidate });

/** Creates a draft and publishes it. Returns a serializable result, never throws. */
export async function composeAndPublish(
  formData: FormData,
): Promise<FoPostActionResult<{ postId: string }>> {
  const text = String(formData.get('text') ?? '');
  const accounts = formData.getAll('accounts').map(String);

  const created = await createPost({
    workspaceId: WORKSPACE_ID,
    content: [{ text }],
    accounts,
  });
  if (!created.ok) return created;

  const published = await publishPost(created.data.id);
  if (!published.ok) return published;

  return { ok: true, data: { postId: created.data.id } };
}
