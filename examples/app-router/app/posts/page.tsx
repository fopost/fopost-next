// Server Component. The client is server-only, so nothing here reaches the browser.
import { getFoPostClient, foPostTags } from '@fopost/next';
import { ComposeForm } from './compose-form';

const WORKSPACE_ID = process.env.FOPOST_WORKSPACE_ID!;

export default async function PostsPage() {
  const fopost = getFoPostClient();

  const [accounts, posts] = await Promise.all([
    fopost.accounts.list({ workspaceId: WORKSPACE_ID }),
    fopost.posts.list({ workspaceId: WORKSPACE_ID, limit: 20 }),
  ]);

  return (
    <main>
      <h1>Scheduled posts</h1>

      <ul>
        {posts.map((post) => (
          <li key={post.id}>
            {post.title ?? post.summary ?? post.id} — {post.status}
          </li>
        ))}
      </ul>

      {/* Only ids cross to the client. */}
      <ComposeForm accounts={accounts.map((a) => ({ id: a.id, username: a.username }))} />

      <p>
        This page is revalidated by the webhook route through the{' '}
        <code>{foPostTags.posts(WORKSPACE_ID)}</code> tag.
      </p>
    </main>
  );
}
