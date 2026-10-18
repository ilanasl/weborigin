# Google APIs: setup, commands, manual checklist

## One-time setup (once for all sites)

Walk the user through this the first time; afterwards each new client only needs step 4.

1. **Google Cloud project** — console.cloud.google.com → new project (e.g. `web-tracking`).
2. **Enable APIs** (APIs & Services → Library): *Google Analytics Admin API*, *Google Analytics Data API*, *Tag Manager API*, *Google Search Console API*, *Site Verification API*.
   With gcloud: `gcloud services enable analyticsadmin.googleapis.com analyticsdata.googleapis.com tagmanager.googleapis.com searchconsole.googleapis.com siteverification.googleapis.com --project <id>`
3. **Service account** — IAM & Admin → Service accounts → Create (no project roles needed) → Keys → Add key → JSON. Its email looks like `tracking@web-tracking.iam.gserviceaccount.com`.
   If the organization blocks key creation (`iam.disableServiceAccountKeyCreation`), either relax the policy for this project or use your own Google user via ADC (below).
4. **Give the service account access per client** (this is the per-site step):
   - **GA4**: Admin → *Account* access management → add the SA email → role **Editor** (account level lets it create properties; property level is enough for existing properties).
   - **GTM**: Admin → User management (account) → add the SA email → account permission **User** (or **Admin** to create containers), container permission **Publish**.
   - **Search Console**: for existing properties — Settings → Users and permissions → add the SA email as **Owner** (needed to manage owners; Full is enough for sitemaps). For new properties the SA verifies them itself (`gsc setup`) and adds the client as owner.
   - **Google Ads** (only if linking via API): the SA can't be an Ads user easily — do the GA4↔Ads link in the UI instead.
5. **Store the key, never commit it.**
   - Local machine: save outside the repo, `export GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/tracking-sa.json`.
   - Claude Code cloud sessions: add an environment variable `GOOGLE_SA_KEY_JSON` with the whole JSON content in the environment's settings (read `read_documentation` topic `environment.secrets` for where), and allow these hosts if the network policy is restricted: `analyticsadmin.googleapis.com`, `analyticsdata.googleapis.com`, `tagmanager.googleapis.com`, `www.googleapis.com`, `searchconsole.googleapis.com`, `oauth2.googleapis.com`, `www.googletagmanager.com`.
   - The repo `.gitignore` already ignores `*service-account*.json`, `*-sa.json`, `.secrets/`. If you see a key file inside the repo, stop and tell the user.
6. `pip install google-auth requests`, then `python3 .claude/skills/google-tracking/scripts/gapi.py whoami` — it lists the GA4/GTM/Search Console accounts the SA can reach.

**ADC alternative (own Google user, no key):** `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/analytics.edit,https://www.googleapis.com/auth/tagmanager.edit.containers,https://www.googleapis.com/auth/tagmanager.publish,https://www.googleapis.com/auth/tagmanager.edit.containerversions,https://www.googleapis.com/auth/webmasters,https://www.googleapis.com/auth/siteverification,https://www.googleapis.com/auth/cloud-platform` — Google sometimes blocks these scopes for gcloud's built-in OAuth client; then create a Desktop OAuth client in the project and pass `--client-id-file`.

## Commands

`S=.claude/skills/google-tracking/scripts/gapi.py`. Global `--dry-run` works before or after the subcommand. Mutating commands print one line per change.

| Command | What it does |
|---|---|
| `whoami` | Identity + reachable accounts/sites per API |
| `ga4 accounts` | Accounts and properties (IDs for the plan) |
| `ga4 streams --property P` | Web streams with measurement IDs |
| `ga4 key-events --property P` | Current key events |
| `ga4 realtime --property P` | Events received in the last 30 min (verification after deploy) |
| `ga4 apply --plan F` | Create property (if `propertyId` empty; needs `accountId`) and web stream (if missing); mark key events; create custom dimensions; set data retention; turn on SPA history page views for vite/next stacks; link Ads (if `ads.customerId`). Writes IDs back to the plan. Never deletes. |
| `gtm accounts` / `gtm containers --account A` | IDs for the plan |
| `gtm inspect --plan F` (or `--account A --container C`) | Live version summary, workspace tags (type, ID, event, triggers, paused), triggers, variables, unpublished changes |
| `gtm apply --plan F [--publish]` | Create container if missing; upsert `DLV - *` variables, `CE - *` triggers, `GA4 - Google Tag`, `GA4 - Event - *`, `Ads - *` tags. Skips creating a tag when an existing unmanaged tag already does the same job (same G- Google tag, same GA4 event name, same Ads label, any Conversion Linker) to avoid double sending. Flags `ua`/`gaawc` legacy tags. `--publish` creates a version and publishes it. |
| `gsc sites` | Properties the SA can access and its permission |
| `gsc setup --plan F` | If the SA lacks access: get a verification token (DNS TXT for `sc-domain:`, META for URL-prefix, or verify directly with `ANALYTICS` / `TAG_MANAGER` when the SA has GA edit / GTM publish rights on the tag running on the site), verify, add `searchConsole.owners` as owners, add the site; then submit the sitemap. Re-run after deploying the token. |
| `gsc sitemaps --property SITE` | Submitted sitemaps with status/errors |
| `gsc inspect-url --property SITE --url URL` | Index status of one URL |

**Verification method tip:** for a URL-prefix property on a site that already runs the client's GTM container, `"verification": "TAG_MANAGER"` verifies with no DNS or code change (the SA must have Publish on that container and the container snippet must be on the home page). For a domain property (`sc-domain:`) DNS is the only option — the user (or whoever holds the DNS) adds the TXT record.

## Manual checklist

Use when there is no API access, and always for the items marked *(UI only)*. Write it in Hebrew, numbered, with the real values from the plan filled in. Template:

```
צ'קליסט חיבור — <שם האתר> (<url>)

Google Analytics 4  (analytics.google.com)
1. Admin → Create → Property: שם "<name>", אזור זמן ישראל, מטבע ₪ (ILS).
2. Data streams → Web → כתובת <url> → Measurement ID: ______ (להעביר אליי)
3. ב-Stream: Enhanced measurement פעיל (באתר React/Next לוודא ש-"Page changes based on browser history events" מסומן).
4. Admin → Data retention → 14 months.
5. Admin → Events → (אחרי שהאירועים מתחילים להגיע) לסמן כ-Key event: <events>.
6. Admin → Custom definitions → Create custom dimension: <params> (Scope: Event).
7. (UI only) Admin → Product links → Search Console links → Link → לבחור <property>.
8. (UI only) Admin → Product links → Google Ads links → Link (אם יש חשבון Ads).

Google Tag Manager  (tagmanager.google.com)
9. Create container: "<name>", Web → Container ID: GTM-______ (להעביר אליי).
10. Tag "GA4 - Google Tag": Google Tag, Tag ID = <G-…>, Trigger: Initialization - All Pages.
11. לכל אירוע: Variable מסוג Data Layer Variable לכל פרמטר, Trigger מסוג Custom Event בשם האירוע, Tag מסוג "Google Analytics: GA4 Event" עם Measurement ID <G-…> ו-Event parameters.
12. Preview → לבדוק באתר → Submit → Publish.

Search Console  (search.google.com/search-console)
13. Add property → Domain: <domain> → להוסיף רשומת TXT ב-DNS (אצל <רשם הדומיין>) → Verify.
    (או URL prefix → אימות דרך Google Analytics / Tag Manager אם כבר מותקנים)
14. Sitemaps → להגיש <sitemap url>.
15. Settings → Users and permissions → להוסיף את <owner email> כבעלים.
```
