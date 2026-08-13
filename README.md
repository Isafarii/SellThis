# SellThis

SellThis turns 1–5 item photos into validated, ready-to-copy marketplace listings for Facebook Marketplace, eBay, OfferUp/Craigslist, and general use.

## Local development

Requirements: Node.js 22.13 or newer.

1. Copy `.env.example` to `.env.local`.
2. Add a Gemini Developer API key as `GEMINI_API_KEY`.
3. Run `npm install`.
4. Run `npm run dev`.

`GEMINI_MODEL` defaults to `gemini-3.1-flash-lite`. The API key is read only by server routes and is never sent to browser code.

## How it works

- The browser validates, resizes, and compresses images to stay within Vercel's request-size limits before upload.
- `/api/generate` validates file count, size, MIME type, and file signatures before sending inline image data to Gemini.
- Gemini is constrained with JSON Schema, and its response is independently checked against an exact runtime schema before use.
- `/api/regenerate` rewrites listing copy from user-corrected attributes without requiring another upload.
- If Gemini is unavailable and the user supplied enough text, deterministic templates produce a basic listing.
- Photos are held only in request memory and are not written to storage.

## Commands

- `npm run dev` — run the local app
- `npm run build` — build and validate the production artifact
- `npm run lint` — run ESLint
- `node --experimental-strip-types --test tests/listing.test.ts tests/routes.test.ts` — run schema, Gemini-request, fallback, and route tests

## Deployment

Create a Next.js project in Vercel and set `GEMINI_API_KEY` as a server-side environment variable for Production, Preview, and Development. Optionally set `GEMINI_MODEL`. Do not prefix either variable with `NEXT_PUBLIC_`.
