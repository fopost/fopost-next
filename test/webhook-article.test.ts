import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  FOPOST_DELIVERY_HEADER,
  FOPOST_TIMESTAMP_HEADER,
  FOPOST_TIMESTAMPED_SIGNATURE_HEADER,
  articleWebhook,
  type ArticleWebhookOptions,
} from '../src/index.js';

const SECRET = 'whsec_website_secret';

const ARTICLE = {
  id: 'art_1',
  title: 'Scheduling across networks',
  slug: 'scheduling-across-networks',
  excerpt: null,
  metaTitle: null,
  metaDescription: null,
  bodyMarkdown: '# Scheduling\n\nText.',
  bodyHtml: '<h1>Scheduling</h1><p>Text.</p>',
  featuredImage: { mediaId: 'med_1', url: 'https://cdn.example.test/a.png', alt: 'Cover' },
  images: [],
  tags: ['scheduling'],
  keyword: 'scheduling',
  wordCount: 2,
  publishedAt: '2026-10-11T10:00:00.000Z',
  publishedUrl: 'https://fopost.com/blog/scheduling-across-networks',
};

function envelope(event: string, data: unknown = ARTICLE): string {
  return JSON.stringify({ event, data, timestamp: '2026-10-11T10:00:00.000Z' });
}

function signed(rawBody: string, secret = SECRET): Request {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  return new Request('https://app.example.test/api/fopost/articles', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [FOPOST_TIMESTAMP_HEADER]: String(timestamp),
      [FOPOST_TIMESTAMPED_SIGNATURE_HEADER]: `sha256=${digest}`,
      [FOPOST_DELIVERY_HEADER]: 'dlv_7',
    },
    body: rawBody,
  });
}

describe('articleWebhook', () => {
  it('answers { ok: true } to a signed article.test and never runs the callback', async () => {
    const onArticlePublished = vi.fn();
    const handler = articleWebhook({ secret: SECRET, onArticlePublished });

    const res = await handler(signed(envelope('article.test')));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(onArticlePublished).not.toHaveBeenCalled();
  });

  it('rejects a tampered body with 401', async () => {
    const onArticlePublished = vi.fn();
    const handler = articleWebhook({ secret: SECRET, onArticlePublished });

    const request = signed(envelope('article.published'));
    const tampered = new Request(request, {
      body: envelope('article.published', { ...ARTICLE, title: 'Edited in flight' }),
    });

    const res = await handler(tampered);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'invalid_signature' });
    expect(onArticlePublished).not.toHaveBeenCalled();
  });

  it('hands article.published to the callback and echoes the URL it returns', async () => {
    const onArticlePublished = vi.fn<ArticleWebhookOptions['onArticlePublished']>(
      async (article) => `https://yourbrand.com/blog/${article.slug}`,
    );
    const handler = articleWebhook({ secret: SECRET, onArticlePublished });

    const res = await handler(signed(envelope('article.published')));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: 'https://yourbrand.com/blog/scheduling-across-networks',
    });
    expect(onArticlePublished).toHaveBeenCalledOnce();
    const [article, context] = onArticlePublished.mock.calls[0]!;
    expect(article).toEqual(ARTICLE);
    expect(context?.deliveryId).toBe('dlv_7');
  });
});
