---
name: google-tracking
description: Connect a website to Google Analytics 4, Google Tag Manager, Google Search Console and conversion tracking (GA4 key events, Google Ads conversions), or audit and upgrade a site that is already partly connected. Works on static HTML, React/Vite, Next.js and WordPress sites, and can configure the Google accounts themselves through the GA4 Admin, Tag Manager, Search Console and Site Verification APIs with a service account. Use this skill whenever the user mentions analytics, GA4, gtag, GTM, Tag Manager, Search Console, site verification, sitemap submission, conversions, key events, leads tracking, dataLayer, Consent Mode, or tracking WhatsApp/phone/form clicks on a site — including Hebrew phrasing like אנליטיקס, גוגל אנליטיקס, תג מנגר, סרץ' קונסול, המרות, מעקב המרות, לחבר אתר לגוגל, פיקסל — even if they only ask to "check what's connected" or "add tracking".
---

# Google tracking: GA4 + GTM + Search Console + conversions

The goal is a site where every page loads exactly one tag manager container, GA4 receives clean page views and meaningful conversion events, Search Console is verified with a sitemap, and all of it is written down in a per-site plan file so the next upgrade starts from facts instead of guesses.

Talk to the user in their language (usually Hebrew). Keep code, IDs and event names in English.

## Architecture (the default for every site)

- **GTM is the only thing in the page source.** The site code loads the GTM container and pushes semantic events to `window.dataLayer`. GA4, Google Ads and any other pixel are configured *inside* GTM. This keeps the code stable while marketing changes happen in GTM, and it prevents the most common bug in partly-connected sites: GA4 loaded twice (once by a hard-coded gtag snippet, once by GTM) and every hit counted double.
- **Events describe what the visitor did, not which tool receives it.** The site pushes `{event: 'generate_lead', form_id: 'contact'}`; GTM decides that this is a GA4 key event and also a Google Ads conversion.
- **Use GA4 recommended event names** where one fits (`generate_lead`, `purchase`, `sign_up`, `begin_checkout`...) because GA4 and Ads reports understand them out of the box. See `references/conversions.md`.
- **Consent defaults come before GTM** whenever the site needs a consent banner. See `references/consent.md`.
- **One file is the source of truth per site:** `tracking-plan.json` in the site's root folder (schema: `assets/tracking-plan.example.json`). The scripts read it, and you update it at the end of every run.

## Workflow

### 1. Identify the site

Figure out (from the repo and by asking only what you can't find):
- Site folder and stack — static HTML, React/Vite SPA, Next.js, or WordPress. The stack decides which file in `references/stacks.md` applies.
- Production URL (needed for the GA4 stream, Search Console and the live audit).
- Business type — lead generation (service business, clinic, doula, lawyer), e-commerce, booking, content/blog, SaaS. This decides the conversions.
- Whether `tracking-plan.json` already exists. If yes, you are in **upgrade mode**: read it first.

### 2. Audit what already exists

Run the auditor on the code, and on the live site when there is a URL:

```bash
python3 .claude/skills/google-tracking/scripts/audit_site.py <site-folder> [--url https://example.co.il]
```

It reports every GTM/GA4/UA/Ads ID it finds, how each is loaded, dataLayer and gtag events in code, verification tags, consent calls, other pixels, sitemap/robots status, WordPress tracking plugins, and pages missing the container — followed by a list of problems. With `--url` it also reads the public `gtm.js` of each container to show which GA4 IDs are configured inside it.

If API credentials are set up (step 4), look at the account side too: `gapi.py gtm inspect`, `gapi.py ga4 key-events`, `gapi.py gsc sites`. Partly-connected sites are often fine in code but missing key events or a sitemap on the Google side, or the other way round.

For a partly-connected site, read `references/upgrade.md` now — it lists the common broken states and how to migrate each one without losing data history.

### 3. Write the plan and confirm it

Create or update `tracking-plan.json` from the audit and the business type:
- Reuse every existing ID. Never create a new GA4 property or GTM container when the site already has one the user can access — a new property throws away the reporting history.
- Pick conversions from `references/conversions.md`. A typical lead-gen site: `generate_lead` (form success), `contact_click` with `method` = phone / whatsapp / email, and maybe `book_appointment`. Mark the ones that matter for the business as `keyEvent: true`.
- Decide consent mode (`none`, `eea-denied`, `deny-all` — `references/consent.md`). Health, pregnancy and children's sites deserve the stricter options; raise it with the user.

Show the user a short summary — what exists, what will change in code, what will change in their Google accounts, and the conversion list — and get a yes before touching their Google accounts or removing existing tags. Changes in GA4/GTM/Search Console are live and visible to the client, so they deserve a confirmation; code changes on a branch don't need the same ceremony.

### 4. Configure the Google side

Two paths; use the API path when credentials exist, otherwise hand the user a checklist.

**API path.** One-time setup and every command are in `references/google-apis.md`. In short: a service account whose email has been added as a user in GA4, GTM and Search Console, and its key in `GOOGLE_SA_KEY_JSON` or `GOOGLE_APPLICATION_CREDENTIALS` (never committed). Then:

```bash
S=.claude/skills/google-tracking/scripts/gapi.py
python3 $S whoami                                   # which accounts the service account can reach
python3 $S ga4 apply --plan <site>/tracking-plan.json --dry-run
python3 $S ga4 apply --plan <site>/tracking-plan.json   # property/stream if missing, key events, custom dimensions, retention
python3 $S gtm apply --plan <site>/tracking-plan.json --dry-run
python3 $S gtm apply --plan <site>/tracking-plan.json --publish
python3 $S gsc setup --plan <site>/tracking-plan.json   # verification + site + sitemap + owner
```

Always run `--dry-run` first and read the output: `apply` creates and updates only the items it manages (named `GA4 - ...`, `CE - ...`, `DLV - ...`, `Ads - ...`) and leaves everything else in the container alone, but it's still the client's live container. `apply` writes newly created IDs (property, measurement ID, container public ID) back into the plan file.

**Checklist path.** Produce a numbered Hebrew checklist with exact menu paths and the exact values from the plan (template in `references/google-apis.md#manual-checklist`). Some things have no API and always go on the checklist: linking Search Console to GA4, linking Google Ads to GA4 (unless `ads.customerId` is set and the API link works), and accepting data-sharing terms.

### 5. Change the code

Follow the section for the stack in `references/stacks.md`. Whatever the stack:
- Load GTM high in `<head>` and the `<noscript>` iframe right after `<body>` on **every** page. For static multi-page sites use `scripts/inject_gtm.py` instead of editing pages by hand — it's idempotent and covers pages you'd miss.
- Add the event helper (`assets/tracking.js` for static/WordPress, `assets/tracking.module.js` for React/Next). It gives you `track(event, params)` plus automatic `contact_click` for `tel:`, `mailto:` and WhatsApp links, so a typical brochure site needs almost no custom code.
- Fire `generate_lead` on *confirmed* success (AJAX success callback, plugin success event, or thank-you page), not on button click — click-based lead counts include failed validation and bots and inflate conversions.
- In upgrade mode, remove hard-coded gtag/GA4 snippets only after the same GA4 ID is configured in GTM, and in the same change, so there is never a window with zero or double tracking.
- If Search Console verification uses the META method, add the verification `<meta>` tag to the home page `<head>` (the `gsc setup` command prints it).

### 6. Verify

Check what you can yourself, and tell the user exactly what's left for them:
- Re-run `audit_site.py` — the problem list should be empty or only contain things you deliberately left.
- If the site runs locally or is deployed, load it in Playwright (Chromium is preinstalled) and capture requests to `googletagmanager.com/gtm.js` and `google-analytics.com/g/collect` (or `region1.google-analytics.com`) while clicking a phone link and submitting a form; each event should produce exactly one collect hit with the expected `en=` parameter. A snippet is in `references/stacks.md#verifying-with-playwright`.
- After deploy, with API access: `gapi.py ga4 realtime --property <id>` shows the events GA4 received in the last 30 minutes.
- Manual steps for the user: GTM Preview (Tag Assistant), GA4 DebugView, Search Console URL inspection.

Key events show up in standard GA4 reports after 24–48 hours; realtime and DebugView are immediate. Say this so nobody panics on day one.

### 7. Record

Update `tracking-plan.json`: IDs, events with their status (`live`, `pending-deploy`, `manual-step`), `status.lastAudit` (today's date), and short notes on anything left open. Mention the plan file and the open items in your final message.

## Reference files

- `references/stacks.md` — exact code for static HTML, React/Vite, Next.js (App and Pages router), WordPress (mu-plugin, GTM4WP, form plugins, WooCommerce), and Playwright verification.
- `references/conversions.md` — which events to track per business type, dataLayer schemas, GA4 parameter rules, Google Ads conversions, other pixels through GTM.
- `references/consent.md` — Consent Mode v2 snippets and when a banner is needed.
- `references/upgrade.md` — common partial setups (UA leftovers, double tagging, hard-coded events, Site Kit/MonsterInsights) and safe migration paths.
- `references/google-apis.md` — service account setup, permissions, every `gapi.py` command, the manual checklist template.

## Scripts and assets

- `scripts/audit_site.py` — static + live audit. `--json` for machine-readable output.
- `scripts/inject_gtm.py` — add/replace the GTM snippet in all HTML files of a folder, between marker comments.
- `scripts/gapi.py` — GA4 Admin / GTM / Search Console / Site Verification / GA4 realtime CLI, plan-driven and idempotent. Needs `pip install google-auth requests`.
- `assets/tracking.js` / `assets/tracking.module.js` — dataLayer helper with automatic contact-click tracking (plain script / SSR-safe ES module).
- `assets/tracking-plan.example.json` — plan file schema with comments in `_doc` fields.
