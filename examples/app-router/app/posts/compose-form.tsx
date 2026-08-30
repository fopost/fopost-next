'use client';

import { useActionState } from 'react';
import { composeAndPublish } from './actions';

type AccountOption = { id: string; username: string };

export function ComposeForm({ accounts }: { accounts: AccountOption[] }) {
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => composeAndPublish(formData),
    null,
  );

  return (
    <form action={action}>
      <textarea name="text" required placeholder="What are you shipping?" />

      {accounts.map((account) => (
        <label key={account.id}>
          <input type="checkbox" name="accounts" value={account.id} />
          {account.username}
        </label>
      ))}

      <button type="submit" disabled={pending}>
        Publish Post
      </button>

      {/* The error is a plain object, so it survives the RSC boundary. */}
      {state && !state.ok && <p role="alert">{state.error.message}</p>}
      {state?.ok && <p>Queued for delivery: {state.data.postId}</p>}
    </form>
  );
}
