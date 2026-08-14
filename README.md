# SellThis

SellThis turns 1–5 item photos into validated, ready-to-copy marketplace listings for Facebook Marketplace, eBay, OfferUp/Craigslist, and general use.

## Local development

Requirements: Node.js 22.13 or newer.

1. Copy `.env.example` to `.env.local`.
2. Add a Gemini Developer API key as `GEMINI_API_KEY`.
3. Run `npm install`.
4. Run `npm run dev`.

`GEMINI_MODEL` defaults to `gemini-3.1-flash-lite`. The API key is read only by server routes and is never sent to browser code.

To show the optional support link, set `NEXT_PUBLIC_SUPPORT_URL` to a real hosted Stripe Payment Link. The link remains hidden when this variable is absent.

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

## Marketplace handoff decisions

- **eBay:** The official Inventory API can create inventory items and offers and publish listings. A production integration is deferred because it requires seller OAuth/token storage, business policies, an inventory location, category/aspect mapping, public image URLs, and seller-entered commerce fields. SellThis currently opens eBay's supported listing flow with fast copy controls.
- **Facebook Marketplace:** Meta's listing APIs are for approved Marketplace partners, not a public consumer-posting API. SellThis opens the item form and keeps posting manual.
- **OfferUp:** Consumer item posting continues in the OfferUp mobile app. SellThis provides copy controls and opens OfferUp without attempting unsupported automation.
- **Craigslist:** The bulk interface is not a general consumer integration. SellThis opens Craigslist's normal posting flow with copy controls.

An autofill extension is not part of the MVP. A website cannot inject into unrelated marketplace pages, while an extension would need host permissions and marketplace-specific DOM maintenance. OfferUp explicitly prohibits third-party applications and automated use without written consent, and Craigslist prohibits unlicensed software that interacts with its posting service. Reconsider an extension only for a platform that grants written permission or publishes a supported integration surface.
