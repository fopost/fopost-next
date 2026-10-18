# Changelog

All notable changes to `@fopost/next` are documented here.

## Unreleased

### Added

- `articleWebhook({ secret?, onArticlePublished })`, an App Router `POST` handler for a blog
  website target. It verifies the delivery, answers `{ ok: true }` to `article.test`, hands the
  typed `ArticlePublishedPayload` to the callback on `article.published`, and echoes a returned
  URL as `{ url }`.
- `article.published` in `FOPOST_WEBHOOK_EVENTS`, so `createFoPostWebhookHandler` can dispatch
  it.
- `FOPOST_TIMESTAMP_HEADER` and `FOPOST_TIMESTAMPED_SIGNATURE_HEADER`.

### Changed

- Signature verification delegates to `verifyWebhookSignature` from `@fopost/sdk`. The
  timestamped `X-FoPost-Signature-256` is preferred and refused after 300 seconds; the body-only
  `X-FoPost-Signature` is accepted only when no timestamp header is sent. `verifyFoPostSignature`
  is now async, returns `Promise<boolean>`, and takes `headers` beside the existing `signature`.
- `@fopost/sdk` requirement moved to `^0.6.0`, the npm release that carries `blog` and
  `verifyWebhook`, replacing the `feature/blog-articles` branch pin.
