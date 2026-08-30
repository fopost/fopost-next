# App Router example

A minimal Next.js App Router slice showing the three surfaces `@fopost/next` covers:

| File                              | What it shows                                                      |
| --------------------------------- | ------------------------------------------------------------------ |
| `app/posts/page.tsx`              | Reading FoPost data in a Server Component, tagged for revalidation |
| `app/posts/actions.ts`            | A Server Action that creates and publishes a post                  |
| `app/posts/compose-form.tsx`      | The Client Component that calls it — no API key in sight           |
| `app/api/fopost/webhook/route.ts` | The webhook Route Handler, verified and revalidating               |

## Running it

Drop these files into a Next.js 14 or 15 app, then:

```bash
npm install @fopost/next
```

`.env.local` (server-side only — never `NEXT_PUBLIC_`):

```dotenv
FOPOST_API_KEY=fp_your_key_here
FOPOST_WEBHOOK_SECRET=whsec_from_the_webhook_you_created
FOPOST_WORKSPACE_ID=your_workspace_uuid
```

Create the webhook in the FoPost dashboard pointing at
`https://your-app.example.com/api/fopost/webhook`, and copy its secret into
`FOPOST_WEBHOOK_SECRET`.
