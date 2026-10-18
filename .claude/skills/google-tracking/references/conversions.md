# Conversions and events

## Rules that keep data clean

- **Event names:** GA4 recommended names first (they unlock built-in reports and Ads import), otherwise `snake_case`, ≤ 40 chars, starting with a letter. Don't invent synonyms of recommended events (`lead_submit` when `generate_lead` exists).
- **Parameters:** ≤ 25 per event, names ≤ 40 chars, values ≤ 100 chars. A parameter only shows in reports after it's registered as a custom dimension — put the useful ones in `customDimensions` in the plan (50 event-scoped dimensions per standard property; don't register everything).
- **No PII** in any event or parameter: no email, phone number, name, ID number, or free text a visitor typed. `link_url` for `tel:` links is the *business's* phone number, which is fine.
- **Fire on success, once.** A lead is counted when the server accepted it. Key events default to `ONCE_PER_EVENT`; use `"counting": "ONCE_PER_SESSION"` in the plan for leads when a visitor tends to submit twice.
- **Key events** (GA4's name for conversions since 2024) are what the business is judged on — typically 1–4. Everything else is a normal event. Google Ads conversions are imported from key events or sent by an Ads conversion tag.
- Enhanced Measurement already gives `page_view`, `scroll`, `click` (outbound), `file_download`, `view_search_results`, `video_*`, `form_start`/`form_submit`. Don't rebuild those. Its form events fire on any submit including failures, so they don't replace `generate_lead`.

## By business type

### Lead generation (service providers, clinics, doulas, lawyers, contractors)
| Event | Key event | Params | Fires |
|---|---|---|---|
| `generate_lead` | ✔ | `form_id`, `lead_source` (optional: which service) | form success / thank-you page |
| `contact_click` | ✔ | `method` (phone / whatsapp / email), `link_url`, `link_location` | automatic via tracking.js |
| `book_appointment` | ✔ if there's online booking | `service` | booking confirmed (Calendly: `calendly.event_scheduled` postMessage) |
| `view_prices` / `select_content` | – | `content_type`, `item_id` | clicks on price/package sections |

For Israeli service businesses WhatsApp is usually the main channel — `contact_click` with `method=whatsapp` often outnumbers forms 5:1, so it must be a key event. Calendly embed listener:
```js
window.addEventListener('message', e => { if (e.data?.event === 'calendly.event_scheduled') siteTracking.track('book_appointment', { service: 'intro-call' }); });
```

### E-commerce
Use the full GA4 ecommerce set with an `ecommerce` object (`items[]` with `item_id`, `item_name`, `price`, `quantity`; `value`, `currency`): `view_item_list`, `view_item`, `add_to_cart`, `view_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info`, `purchase` (with unique `transaction_id`), optionally `refund`. Key events: `purchase` (GA4 marks it automatically), sometimes `begin_checkout`. Set `"ecommerce": true` on these events in the plan so the GTM tag reads the `ecommerce` object. WooCommerce → GTM4WP does this; Shopify has its own Google & YouTube app (out of scope here).
```js
track('purchase', { ecommerce: { transaction_id: 'A1001', value: 349, currency: 'ILS', items: [{ item_id: 'course-1', item_name: 'קורס הכנה ללידה', price: 349, quantity: 1 }] } });
```
Add `value`, `currency`, `transaction_id` to the event's `params` too when an Ads conversion tag needs them.

### Booking / courses / events
`generate_lead` for inquiries, `begin_checkout` → `purchase` for paid registration, `sign_up` for free registration, `book_appointment` for scheduled sessions.

### Content / blog
`sign_up` (newsletter, `method`), `share` (`method`, `content_type`, `item_id`), `select_content`. Key event: usually `sign_up`.

### SaaS / apps
`sign_up` (`method`), `login`, `tutorial_begin` / `tutorial_complete`, a custom core action (e.g. `upload_material`, `practice_complete`), `purchase` / `begin_checkout` for subscriptions. Key events: `sign_up`, `purchase`.

## dataLayer shape

Flat, one push per event, `event` first:
```js
dataLayer.push({ event: 'generate_lead', form_id: 'contact', lead_source: 'vbac-workshop' });
```
`gtm apply` creates one Data Layer Variable per parameter (`DLV - form_id`), one Custom Event trigger per event (`CE - generate_lead`) and one GA4 event tag per event (`GA4 - Event - generate_lead`) that maps every listed parameter. A parameter that's missing in a given push is simply not sent.

## Google Ads conversions

Two ways; pick one per conversion so it isn't counted twice in Ads:
1. **Import GA4 key events into Ads** (Ads → Goals → Conversions → Import → Google Analytics 4). Needs the GA4↔Ads link. Easiest; slight delay; attribution follows Ads settings.
2. **Ads conversion tag in GTM** — fill `ads.conversionId` (number from `AW-123456789`) and `ads.conversions[]` with `{event, label}` from Ads → Goals → conversion action → Tag setup → "Use Google Tag Manager". `gtm apply` adds the Conversion Linker + one `Ads - Conversion - <event>` tag. Better for bidding accuracy; recommended when the client actively runs Ads.

With Consent Mode, Ads tags respect `ad_storage` / `ad_user_data` automatically.

Enhanced Conversions (hashed email/phone for better matching) is a separate opt-in; set it up only when the client asks and has a consent basis — it uses PII by design.

## Other pixels through GTM

Meta Pixel, TikTok, LinkedIn, Microsoft Clarity/UET go in GTM as Community Template tags firing on the same `CE - <event>` triggers (`generate_lead` → Meta `Lead`, `purchase` → `Purchase`, `contact_click` → `Contact`). `gtm apply` doesn't create them (template IDs vary per container); add them in the GTM UI and record them in the plan's `status.notes`. Meta's Conversions API (server side) is out of scope.
