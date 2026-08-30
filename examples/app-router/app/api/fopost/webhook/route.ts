import { createFoPostWebhookHandler } from '@fopost/next';

// A webhook must run on the Node.js runtime: signature verification uses node:crypto.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createFoPostWebhookHandler({
  // secret defaults to process.env.FOPOST_WEBHOOK_SECRET
  on: {
    'post.published': async ({ payload, deliveryId }) => {
      console.log('published', payload.data, deliveryId);
    },
    'post.failed': async ({ payload }) => {
      console.error('publish failed', payload.data);
    },
    'account.health_changed': async ({ payload }) => {
      console.warn('account health changed', payload.data);
    },
  },
  // Drops the cache tags the event affects, so /posts refetches on next visit.
  revalidate: true,
  onError: (error) => console.error('fopost webhook handler threw', error),
});
