# Consent Mode v2

Not legal advice — the business owner decides; your job is to lay out the options and implement the chosen one correctly.

## What it does

Google tags (GA4, Ads, the Google tag in GTM) read four consent signals: `analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`. When a signal is `denied`, the tags still load but send cookieless pings that GA4 uses for modeling, and Ads stops personalization. Since March 2024 Google requires Consent Mode v2 for EEA/UK traffic if the site uses Ads remarketing/audiences or wants modeled conversions there.

The defaults must be set *before* GTM loads (inline script above the GTM snippet). A banner then calls `gtag('consent', 'update', {...})` when the visitor chooses.

## Choosing `consent.mode` in the plan

| Mode | When | Implementation |
|---|---|---|
| `none` | Local Israeli business, audience in Israel, no Ads remarketing, client accepts a privacy-policy notice instead of a banner | No consent code. Make sure the site has a privacy policy page that mentions Google Analytics/Tag Manager cookies. |
| `eea-denied` (default suggestion) | Any site that may get European visitors or runs Google Ads | `inject_gtm.py --consent` (or the same snippet in React/Next/WP): denied for EEA+UK+CH, granted elsewhere. Needs a banner shown to EEA visitors (a CMP with geo-targeting does this). |
| `deny-all` | Client wants opt-in for everyone (stricter privacy stance, EU-focused business, health/sensitive niche) | `inject_gtm.py --consent --deny-all` + a banner shown to everyone. Expect a large drop in observed GA4 data; modeling fills part of it. |

Israel's Privacy Protection Law Amendment 13 (in force since August 2025) raised enforcement and transparency expectations. Sites in sensitive niches (health, pregnancy, mental health, children) deserve the stricter options — flag it to the user rather than deciding silently.

## Banners

- **A Consent Management Platform with a GTM template** (CookieYes, Cookiebot, Complianz for WordPress) is the least work: install its GTM template tag on the *Consent Initialization – All Pages* trigger, and it sets defaults + updates itself. If you use one, skip the inline defaults (or keep them only as a fallback — never two different default sets). Hebrew/RTL support and accessibility matter for Israeli sites; CookieYes and Complianz handle RTL.
- **Custom banner** (static sites wanting zero dependencies) — on accept/reject:
  ```js
  function setConsent(granted) {
    const v = granted ? 'granted' : 'denied';
    gtag('consent', 'update', { analytics_storage: v, ad_storage: v, ad_user_data: v, ad_personalization: v });
    try { localStorage.setItem('consent', v); } catch (e) {}
  }
  // on load, before the banner decides whether to show:
  try { const saved = localStorage.getItem('consent'); if (saved) gtag('consent', 'update', { analytics_storage: saved, ad_storage: saved, ad_user_data: saved, ad_personalization: saved }); } catch (e) {}
  ```
  `gtag` is defined by the consent defaults snippet. The banner must offer reject as easily as accept, be keyboard-accessible and readable in RTL.

## Verifying

In GTM Preview → *Consent* tab, the defaults should appear on "Consent Initialization" and the update after clicking the banner. In network requests, `gcs=G100` means all denied, `G111` all granted (`gcd` carries the v2 detail).
