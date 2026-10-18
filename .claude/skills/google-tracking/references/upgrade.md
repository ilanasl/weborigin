# Upgrading a partly-connected site

Principles:
- **Keep history.** Reuse the existing GA4 property and stream even if it was set up badly. Only create a new property if nobody can get admin access to the old one — and then say clearly that historical data stays behind.
- **Never a gap, never a double.** Remove the old way of sending data in the same deploy / GTM publish that adds the new one.
- **Event renames break continuity.** If the site already sends e.g. `whatsapp_click` and reports or Ads conversions depend on it, ask before renaming to `contact_click`. Options: keep the old name, or send the new one and keep the old key event for a transition month, then retire it.
- **Ask before deleting** anything in the client's GTM or GA4. Pausing a GTM tag is reversible; deleting isn't.

## Common states and what to do

| What the audit shows | Problem | Fix |
|---|---|---|
| `UA-` IDs, `analytics.js`, `ga('create'...)`, GTM tags of type `ua` | Universal Analytics stopped processing in 2023/2024; dead weight and confusing | Remove from code; pause/delete `ua` tags in GTM (`gtm apply` lists them). |
| Hard-coded `gtag.js` with `G-…` and **no GTM** | Works, but every change needs a deploy; events probably `gtag('event')` in code | Create/reuse GTM, configure the same `G-` in GTM (`gtm apply`), then replace the gtag snippet with GTM and convert `gtag('event', X, p)` → `dataLayer.push({event: X, ...p})`, in one deploy. Publish GTM **just before** the deploy. |
| Hard-coded `gtag.js` **and** GTM, same `G-` inside the container | Double page views and events | Remove the hard-coded gtag snippet (GTM already sends). |
| Hard-coded `gtag.js` (G-A) and GTM with a different G-B | Two properties collecting; one is probably abandoned | Ask which property the client uses; keep that one, remove the other source. |
| gtag snippet only for Google Ads (`AW-`) | Ads tag outside GTM | Move to GTM: `ads.conversionId` + conversions in plan → `gtm apply`; remove the snippet in the same release. |
| GTM in head but no `<noscript>`, or missing on some pages | Partial coverage | `inject_gtm.py` (static) / layout fix; the auditor lists the pages. |
| GTM container loaded but no GA4 inside (`--url` audit: "no GA4 measurement ID") | Container empty or not published | `gtm inspect` → `gtm apply --publish`. |
| Old GA4 setup in GTM: `gaawc` "GA4 Configuration" tag | Deprecated tag type (auto-migrated by Google to Google Tag in most containers) | `gtm apply` skips creating a second Google Tag if one with the same ID exists; a leftover `gaawc` is flagged — replace with Google Tag in the UI after review. |
| GA4 events exist, nothing marked as key event | Client sees "0 conversions" | Add to plan with `keyEvent: true` → `ga4 apply`. |
| Key events marked on Enhanced Measurement `form_submit` | Counts failed/spam submits as conversions | Add a real `generate_lead`, make it the key event, then unmark `form_submit` (UI) after a week of overlap. |
| Click-based lead tracking (`click` on submit button) | Overcounts | Move to success callback / thank-you page. |
| WordPress: Site Kit placing GA4 + GTM4WP/mu-plugin with GA4 in GTM | Double counting | Turn off Site Kit's "Place code" for Analytics; keep Site Kit for Search Console data if the client likes it. |
| WordPress: MonsterInsights/ExactMetrics + GTM | Double or split tracking | Configure GA4 in GTM, deactivate the plugin in the same session. |
| React app with `react-ga4` / `react-ga` | Direct GA in code, often manual page views | Replace with GTM in `index.html` + `tracking.module.js`; delete manual `page_view` calls (Enhanced Measurement history handles SPA routing). |
| Search Console verified by a meta tag of a former agency / developer | Property owned by someone else | Verify with a method the client controls (DNS or GA/GTM), add client as owner; keep the old tag until the new verification is confirmed, then optionally remove the old owner (UI: Settings → Users → Unverified owners). |
| No sitemap / sitemap not in robots.txt | Slower discovery | Generate (stacks.md#sitemaps), add to robots.txt, `gsc setup` submits it. |
| Data retention 2 months (GA4 default) | Explorations limited to 2 months | `ga4 apply` sets 14 months. |
| GA4 not linked to Search Console / Ads | Missing reports | Manual checklist items (no API for Search Console link). |

## Upgrade flow in short

1. `audit_site.py <folder> --url <live>` + `gapi.py gtm inspect` / `ga4 key-events` / `gsc sites`.
2. Write the plan from what exists (fill existing IDs first), mark each event `live` or `planned`.
3. Show the user: keeps / adds / removes / renames. Get a yes for removals and renames.
4. `ga4 apply` → `gtm apply` (dry-run, then real, publish timed with the deploy) → code changes → deploy → `gsc setup`.
5. Re-audit, realtime check, update plan notes with anything to retire later (e.g. "unmark form_submit as key event after 2026-11-20").
