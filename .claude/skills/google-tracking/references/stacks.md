# Code changes per stack

Contents: [Static HTML](#static-html) · [React / Vite SPA](#react--vite-spa) · [Next.js](#nextjs) · [WordPress](#wordpress) · [Sitemaps](#sitemaps) · [Verifying with Playwright](#verifying-with-playwright)

The rule everywhere: GTM snippet as high in `<head>` as possible, `<noscript>` iframe right after `<body>`, Consent defaults (if any) *before* the GTM snippet, the event helper loaded once, and conversion events pushed to `dataLayer` on confirmed success.

---

## Static HTML

1. Inject the container into every page (idempotent, re-runnable):
   ```bash
   python3 .claude/skills/google-tracking/scripts/inject_gtm.py <site> --gtm GTM-XXXXXXX \
     --helper tracking.js [--consent] [--meta-verification <token>] --dry-run
   ```
   Drop `--dry-run` after reading the list. Pages marked ⚠ contain old hard-coded tags — handle them per `upgrade.md`.
   Use a relative helper path (`tracking.js`) for sites in sub-folders or opened from disk, `/tracking.js` when the site is served from a domain root.
2. Copy `assets/tracking.js` to the site root. It auto-tracks phone / WhatsApp / email links.
3. Forms:
   - **Thank-you page (most reliable):** point the form's redirect at `thanks.html` and in that page add
     `<script>window.dataLayer=window.dataLayer||[];dataLayer.push({event:'generate_lead',form_id:'contact'});</script>`
     *before* the closing `</body>`. Mark `noindex` on the thank-you page so it doesn't show up in Google.
   - **AJAX form (Formspree, Netlify, Web3Forms, custom fetch):** call `siteTracking.track('generate_lead', {form_id: 'contact'})` inside the success branch.
   - **No success signal at all:** `<form data-track-lead="contact">` fires on valid submit. Say in the plan that it's submit-based (it slightly overcounts).
4. Custom buttons without code: `<a href="#prices" data-track-event="view_prices" data-track-package="vbac">` → `{event:'view_prices', package:'vbac', link_location:...}`.
5. Use `data-track-location="hero"` on sections when the user wants to know which WhatsApp button converts.

## React / Vite SPA

1. `index.html` — Vite replaces `%VITE_*%` in index.html, so the ID stays in env:
   ```html
   <head>
     <!-- consent defaults here if needed (copy from inject_gtm.py --consent output) -->
     <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
     new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
     j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
     'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
     })(window,document,'script','dataLayer','%VITE_GTM_ID%');</script>
     ...
   <body>
     <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=%VITE_GTM_ID%" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
   ```
   Add `VITE_GTM_ID=GTM-XXXXXXX` to `.env.production` (or the host's env vars — Vercel/Netlify) and to `.env.example`. If `VITE_GTM_ID` is missing Vite leaves the literal text; for preview/dev builds that's acceptable (GTM 404s quietly), but prefer a separate GTM environment or no ID in dev so test traffic doesn't pollute reports.
   Simpler alternative when env handling isn't worth it: hard-code the public ID — a GTM ID is not a secret.
2. Copy `assets/tracking.module.js` to `src/lib/analytics.js`; in the root component:
   ```jsx
   import { useEffect } from 'react';
   import { initAutoTracking } from './lib/analytics';
   useEffect(() => { initAutoTracking(); }, []);
   ```
3. Page views: don't send them manually. With GA4 Enhanced Measurement "Page changes based on browser history events" on (`gapi.py ga4 apply` turns it on for SPA stacks), the Google tag records each route change. Adding a manual `page_view` as well doubles them.
4. Conversions in code — `track('generate_lead', { form_id: 'signup' })` in the `.then()` / after `await` of the real request, `track('sign_up', { method: 'google' })` after the auth call resolves, etc.
5. Apps behind a login (dashboards, study apps): track product events that matter (`sign_up`, `login`, `tutorial_complete`, a core action), never personal data — no emails, names, phone numbers, or free text in parameters. GA4 terms forbid PII and it's an Israeli privacy-law problem too.

## Next.js

**App Router** — use the official package (`npm i @next/third-parties`):
```tsx
// app/layout.tsx
import { GoogleTagManager } from '@next/third-parties/google';
import Script from 'next/script';
export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      {/* consent defaults must run before GTM; omit if consent.mode = none */}
      <Script id="consent-default" strategy="beforeInteractive">{`
        window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
        gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500,region:[/* EEA list from inject_gtm.py */]});
        gtag('consent','default',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted'});
      `}</Script>
      <GoogleTagManager gtmId={process.env.NEXT_PUBLIC_GTM_ID!} />
      <body>{children}</body>
    </html>
  );
}
```
Events: `import { sendGTMEvent } from '@next/third-parties/google'; sendGTMEvent({ event: 'generate_lead', form_id: 'contact' })` in client components, or `track()` from `tracking.module.js`. Auto contact tracking: a tiny `'use client'` component that calls `initAutoTracking()` in `useEffect`, rendered once in the layout. Server Actions can't push to dataLayer — return a success flag and fire the event on the client.

**Pages Router** — `pages/_document.tsx` for the snippet (`<Script id="gtm" strategy="afterInteractive">` in `_app.tsx` also works), or `@next/third-parties` in `_app.tsx`.

Route changes are handled by Enhanced Measurement history events, same as the SPA case.

## WordPress

Pick **one** place that outputs tags. Two plugins both injecting GA4 is the classic double-count.

**A. Code (preferred for brochure sites, no plugin to maintain)** — a must-use plugin survives theme changes and can't be deactivated by accident. Create `wp-content/mu-plugins/site-tracking.php`:
```php
<?php
/* Plugin Name: Site tracking (GTM) */
const SITE_GTM_ID = 'GTM-XXXXXXX';

add_action('wp_head', function () { ?>
<!-- consent defaults here if needed -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','<?php echo esc_js(SITE_GTM_ID); ?>');</script>
<?php }, 1);

add_action('wp_body_open', function () { ?>
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=<?php echo esc_attr(SITE_GTM_ID); ?>" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<?php });

add_action('wp_enqueue_scripts', function () {
  wp_enqueue_script('site-tracking', content_url('mu-plugins/site-tracking/tracking.js'), [], '1.0', ['strategy' => 'defer']);
  wp_add_inline_script('site-tracking', <<<'JS'
  // Form plugin success events → generate_lead
  document.addEventListener('wpcf7mailsent', e => siteTracking.track('generate_lead', {form_id: 'cf7-' + e.detail.contactFormId}));
  if (window.jQuery) {
    jQuery(document).on('submit_success', e => siteTracking.track('generate_lead', {form_id: 'elementor-' + (e.target.getAttribute('name') || e.target.id || 'form')}));
    jQuery(document).on('wpformsAjaxSubmitSuccess', e => siteTracking.track('generate_lead', {form_id: 'wpforms-' + (e.target.dataset.formid || '')}));
    jQuery(document).on('gform_confirmation_loaded', (e, id) => siteTracking.track('generate_lead', {form_id: 'gf-' + id}));
  }
  JS);
});
```
Put `tracking.js` at `wp-content/mu-plugins/site-tracking/tracking.js`. Themes without `wp_body_open` (very old) — the noscript iframe is optional, skip it.
If you only have wp-admin access (no files), the same head/body code goes into WPCode ("Insert Headers and Footers") and the form listeners into a WPCode JS snippet.

**B. GTM4WP plugin ("GTM for WordPress")** — choose it for **WooCommerce**: it pushes the full GA4 ecommerce dataLayer (`view_item`, `add_to_cart`, `begin_checkout`, `purchase` with items) which is a lot of work by hand. Set the container ID, enable "WooCommerce integration → Track e-commerce (GA4)", and its Contact Form 7 integration. Then in GTM, the GA4 event tags need `ecommerce: true` in the plan (sends `ecommerce` from dataLayer).

**Site Kit by Google** — fine for connecting Search Console and showing stats in wp-admin, but don't let it place tags if GTM is used: Site Kit → Settings → Analytics → turn off "Place Google Analytics code" (and the same for Tag Manager if the mu-plugin handles GTM). Leaving both on doubles hits.

**MonsterInsights / ExactMetrics / GA Google Analytics** — direct gtag plugins. In upgrade mode replace with GTM (see `upgrade.md`), deactivating the plugin in the same deploy that publishes GA4 in GTM.

WordPress sitemaps: core has `/wp-sitemap.xml`; Yoast / Rank Math replace it with `/sitemap_index.xml`. Use whichever responds.

## Sitemaps

Static sites usually have none. Generate `sitemap.xml` at the root listing every public page (absolute URLs on the production domain, skip thank-you/404 pages) and add `Sitemap: https://domain/sitemap.xml` to `robots.txt` (create `robots.txt` with `User-agent: *\nAllow: /` if missing). Vite/React SPAs with one route: a one-URL sitemap is still worth submitting. Next.js: `app/sitemap.ts`. Put the URL in `searchConsole.sitemap` in the plan.

## Verifying with Playwright

Works against a local server (`python3 -m http.server` / `npm run preview`) or the live site. GTM must already be published for GA4 hits to appear; before publishing, check only that `gtm.js` loads and `dataLayer` gets the events.

```js
// node verify-tracking.mjs https://localhost:4173
import { chromium } from 'playwright';
const url = process.argv[2];
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
const hits = [];
page.on('request', r => {
  const u = r.url();
  if (u.includes('/g/collect')) hits.push(new URL(u).searchParams.get('en') + ' ' + (r.postData() || '').slice(0, 120));
  if (u.includes('gtm.js?id=')) console.log('GTM loaded:', new URL(u).searchParams.get('id'));
});
await page.goto(url, { waitUntil: 'networkidle' });
// accept the consent banner here if there is one
const tel = page.locator('a[href^="tel:"], a[href*="wa.me"]').first();
if (await tel.count()) await tel.click().catch(() => {});
await page.waitForTimeout(3000);
console.log('dataLayer events:', await page.evaluate(() => (window.dataLayer || []).map(e => e.event || (e[0] === 'consent' ? 'consent' : null)).filter(Boolean)));
console.log('GA4 hits:', hits);
await browser.close();
```
GA4 batches several events into one POST body (lines starting `en=`), so check the body too, not only the URL. If Playwright isn't installed in the project, run it from the scratchpad with `npm i playwright`. Don't run `playwright install`: launch with `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })` in Claude cloud sessions (the preinstalled browser may not match the npm package version), or plain `chromium.launch()` on a machine where Playwright's browsers are installed.
