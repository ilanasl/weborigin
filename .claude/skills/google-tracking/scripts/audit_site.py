#!/usr/bin/env python3
"""Audit a site's Google tracking setup (code and/or live URL).

Usage:
  audit_site.py <site-folder> [--url https://example.com] [--json]
  audit_site.py --url https://example.com

Finds GTM / GA4 / Universal Analytics / Google Ads IDs and how they load,
dataLayer and gtag events, consent calls, Search Console verification tags,
other pixels, WordPress/React tracking packages, sitemap/robots, HTML pages
missing the GTM container, and lists problems. Standard library only.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from collections import defaultdict

SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "out", "vendor", ".vercel", "coverage", "__pycache__"}
TEXT_EXT = {".html", ".htm", ".php", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro", ".json", ".twig", ".liquid", ".ejs", ".hbs", ".njk"}
MAX_BYTES = 2_000_000

P = {
    "gtm_id": re.compile(r"\bGTM-[A-Z0-9]{4,9}\b"),
    "ga4_id": re.compile(r"\bG-[A-Z0-9]{8,12}\b"),
    "ua_id": re.compile(r"\bUA-\d{4,10}-\d{1,4}\b"),
    "ads_id": re.compile(r"\bAW-\d{6,12}\b"),
    "gtm_loader": re.compile(r"googletagmanager\.com/gtm\.js|['\"]gtm\.start['\"]|gtm\.start\s*:"),
    "gtm_noscript": re.compile(r"googletagmanager\.com/ns\.html"),
    "gtag_loader": re.compile(r"googletagmanager\.com/gtag/js"),
    "analytics_js": re.compile(r"google-analytics\.com/(analytics|ga)\.js"),
    "gtag_config": re.compile(r"gtag\(\s*['\"]config['\"]\s*,\s*['\"]([A-Z]+-[A-Z0-9-]+)['\"]"),
    "gtag_event": re.compile(r"gtag\(\s*['\"]event['\"]\s*,\s*['\"]([\w.\- ]+)['\"]"),
    "dl_event": re.compile(r"(?:dataLayer\.push|sendGTMEvent|track)\(\s*\{[^}]{0,300}?['\"]?event['\"]?\s*:\s*['\"]([\w.\-]+)['\"]", re.S),
    "track_call": re.compile(r"\btrack\(\s*['\"]([\w.\-]+)['\"]"),
    "consent_default": re.compile(r"gtag\(\s*['\"]consent['\"]\s*,\s*['\"]default['\"]|['\"]consent['\"]\s*,\s*['\"]default['\"]"),
    "consent_update": re.compile(r"['\"]consent['\"]\s*,\s*['\"]update['\"]"),
    "gsc_meta": re.compile(r"<meta[^>]+name=['\"]google-site-verification['\"][^>]*content=['\"]([^'\"]+)['\"]", re.I),
    "gsc_html_file": re.compile(r"^google[0-9a-f]{16}\.html$"),
    "meta_pixel": re.compile(r"connect\.facebook\.net/[^'\"]*/fbevents\.js|fbq\(\s*['\"]init['\"]"),
    "tiktok": re.compile(r"analytics\.tiktok\.com|ttq\.load\("),
    "hotjar": re.compile(r"static\.hotjar\.com|hjid\s*:"),
    "clarity": re.compile(r"clarity\.ms/tag"),
    "linkedin": re.compile(r"snap\.licdn\.com|_linkedin_partner_id"),
    "cookie_banner": re.compile(r"cookieyes|cookiebot|onetrust|complianz|cookie-law-info|termly|iubenda|klaro|osano|consentmanager", re.I),
}

PACKAGES = {
    "@next/third-parties": "Next.js official GTM/GA component (good)",
    "react-ga4": "react-ga4 (direct GA4 from code — migrate to GTM)",
    "react-ga": "react-ga (Universal Analytics, dead)",
    "react-gtm-module": "react-gtm-module (works, unmaintained)",
    "@analytics/google-analytics": "analytics.js plugin (direct GA)",
    "vue-gtag": "vue-gtag (direct GA)",
    "nextjs-google-analytics": "nextjs-google-analytics (direct GA)",
}

WP_PLUGINS = {
    "google-site-kit": "Site Kit by Google",
    "duracelltomi-google-tag-manager": "GTM4WP",
    "google-analytics-for-wordpress": "MonsterInsights",
    "google-analytics-dashboard-for-wp": "ExactMetrics",
    "ga-google-analytics": "GA Google Analytics",
    "woocommerce-google-analytics-integration": "Google Analytics for WooCommerce",
    "google-listings-and-ads": "Google for WooCommerce",
    "insert-headers-and-footers": "WPCode / Insert Headers and Footers",
    "header-footer-code-manager": "Header Footer Code Manager",
    "complianz-gdpr": "Complianz (consent)",
    "cookie-law-info": "CookieYes (consent)",
    "pixelyoursite": "PixelYourSite",
    "contact-form-7": "Contact Form 7 (form)",
    "wpforms-lite": "WPForms (form)",
    "elementor-pro": "Elementor Pro (forms)",
    "gravityforms": "Gravity Forms (form)",
    "woocommerce": "WooCommerce",
}

LIVE_WP_MARKERS = {
    "Site Kit by Google": re.compile(r"Google Analytics snippet added by Site Kit|google-site-kit", re.I),
    "GTM4WP": re.compile(r"GTM4WP|gtm4wp", re.I),
    "MonsterInsights": re.compile(r"monsterinsights|__gtagTracker", re.I),
    "WordPress": re.compile(r"/wp-content/|/wp-includes/"),
}


def walk(folder):
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for f in filenames:
            yield os.path.join(dirpath, f)


def read(path):
    try:
        if os.path.getsize(path) > MAX_BYTES:
            return None
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return None


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (tracking-audit)"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(MAX_BYTES).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # network, TLS, DNS
        return None, str(e)


class Findings:
    def __init__(self):
        self.ids = defaultdict(lambda: defaultdict(set))  # kind -> id -> {locations}
        self.flags = defaultdict(set)                      # flag -> {locations}
        self.events = defaultdict(set)                     # event -> {locations}
        self.gtag_events = defaultdict(set)
        self.gtag_configs = defaultdict(set)
        self.gsc_tokens = defaultdict(set)
        self.packages = {}
        self.wp_plugins = []
        self.html_pages = {}                               # page -> {"gtm": bool, "noscript": bool, "gtag": bool}
        self.live = {}
        self.problems = []
        self.info = []

    def scan_text(self, text, where, is_page=False):
        for kind in ("gtm_id", "ga4_id", "ua_id", "ads_id"):
            for m in P[kind].findall(text):
                self.ids[kind][m].add(where)
        for flag in ("gtm_loader", "gtm_noscript", "gtag_loader", "analytics_js", "consent_default", "consent_update",
                     "meta_pixel", "tiktok", "hotjar", "clarity", "linkedin", "cookie_banner"):
            if P[flag].search(text):
                self.flags[flag].add(where)
        for m in P["gtag_config"].findall(text):
            self.gtag_configs[m].add(where)
        for m in P["gtag_event"].findall(text):
            self.gtag_events[m].add(where)
        for m in P["dl_event"].findall(text):
            if not m.startswith("gtm."):
                self.events[m].add(where)
        for m in P["track_call"].findall(text):
            self.events[m].add(where)
        for m in P["gsc_meta"].findall(text):
            self.gsc_tokens[m].add(where)
        if is_page:
            self.html_pages[where] = {
                "gtm": bool(P["gtm_loader"].search(text)),
                "noscript": bool(P["gtm_noscript"].search(text)),
                "gtag": bool(P["gtag_loader"].search(text)),
            }


def scan_folder(folder, f):
    for path in walk(folder):
        rel = os.path.relpath(path, folder)
        name = os.path.basename(path)
        if P["gsc_html_file"].match(name):
            f.flags["gsc_html_file"].add(rel)
        if name == "package.json" and "node_modules" not in path:
            try:
                pkg = json.load(open(path, encoding="utf-8"))
                deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
                for p, label in PACKAGES.items():
                    if p in deps:
                        f.packages[p] = label
                for fw in ("next", "vite", "react", "astro", "nuxt", "gatsby"):
                    if fw in deps:
                        f.info.append(f"package.json ({rel}): uses {fw} {deps[fw]}")
            except Exception:
                pass
            continue
        if name in ("package-lock.json", "yarn.lock", "pnpm-lock.yaml"):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext not in TEXT_EXT:
            if name in ("robots.txt",) or name.startswith("sitemap") and ext == ".xml":
                f.flags["sitemap_or_robots_file"].add(rel)
            continue
        text = read(path)
        if text is None:
            continue
        f.scan_text(text, rel, is_page=ext in (".html", ".htm") and "<html" in text.lower())

    plugins_dir = None
    for cand in ("wp-content/plugins", "plugins"):
        d = os.path.join(folder, cand)
        if os.path.isdir(d):
            plugins_dir = d
            break
    if plugins_dir:
        for slug in sorted(os.listdir(plugins_dir)):
            if slug in WP_PLUGINS:
                f.wp_plugins.append(f"{WP_PLUGINS[slug]} ({slug})")
    if os.path.exists(os.path.join(folder, "wp-config.php")) or os.path.isdir(os.path.join(folder, "wp-content")):
        f.info.append("Looks like a WordPress install")


def scan_live(url, f):
    base = url.rstrip("/")
    status, html = fetch(url)
    f.live["home_status"] = status
    if not status:
        f.problems.append(f"Live: could not fetch {url}: {html[:200]}")
        return
    if status >= 400:
        f.problems.append(f"Live: {url} returned HTTP {status}")
        return
    f.scan_text(html, "LIVE " + url, is_page=True)
    for label, rx in LIVE_WP_MARKERS.items():
        if rx.search(html):
            f.live.setdefault("platform_markers", []).append(label)

    rs, robots = fetch(base + "/robots.txt")
    f.live["robots_status"] = rs
    sitemap_urls = re.findall(r"(?im)^\s*sitemap:\s*(\S+)", robots or "") if rs == 200 else []
    f.live["robots_sitemaps"] = sitemap_urls
    candidates = sitemap_urls or [base + "/sitemap.xml", base + "/sitemap_index.xml", base + "/wp-sitemap.xml"]
    found = None
    for sm in candidates:
        s, body = fetch(sm)
        if s == 200 and ("<urlset" in body or "<sitemapindex" in body):
            found = sm
            break
    f.live["sitemap"] = found

    containers = {}
    for gtm in sorted(f.ids["gtm_id"]):
        s, js = fetch(f"https://www.googletagmanager.com/gtm.js?id={gtm}")
        if s == 200:
            containers[gtm] = {
                "ga4_ids": sorted(set(P["ga4_id"].findall(js))),
                "ads_ids": sorted(set(P["ads_id"].findall(js))),
                "ua_ids": sorted(set(P["ua_id"].findall(js))),
                "consent_aware": "consent" in js,
            }
        else:
            containers[gtm] = {"error": f"HTTP {s}"}
    f.live["gtm_containers"] = containers


def analyse(f, folder, url):
    gtm = set(f.ids["gtm_id"])
    ga4 = set(f.ids["ga4_id"])
    ua = set(f.ids["ua_id"])

    if not gtm and not ga4:
        f.problems.append("No GTM container and no GA4 ID found — site is not tracked.")
    if len(gtm) > 1:
        f.problems.append(f"Multiple GTM containers: {', '.join(sorted(gtm))} — confirm each one is intentional.")
    if len(ga4) > 1:
        f.problems.append(f"Multiple GA4 measurement IDs: {', '.join(sorted(ga4))} — usually one property per site.")
    if ua or f.flags.get("analytics_js"):
        f.problems.append(f"Universal Analytics leftovers ({', '.join(sorted(ua)) or 'analytics.js'}) — UA stopped processing data; remove.")
    if f.flags.get("gtag_loader") and gtm:
        in_gtm = set()
        for c in f.live.get("gtm_containers", {}).values():
            in_gtm.update(c.get("ga4_ids", []))
        dup = sorted(set(f.gtag_configs) & in_gtm)
        if dup:
            f.problems.append(f"DOUBLE COUNTING: {', '.join(dup)} is loaded by a hard-coded gtag snippet AND configured inside GTM.")
        else:
            f.problems.append("Both a hard-coded gtag.js snippet and GTM are present — risk of double counting; move GA4 into GTM and remove the gtag snippet."
                              + ("" if url else " (run with --url to check what the container sends)"))
    if f.gtag_events and gtm:
        f.problems.append(f"Events sent with gtag('event') directly ({', '.join(sorted(f.gtag_events))}) — convert to dataLayer events so GTM controls them.")

    pages = f.html_pages
    local_pages = {p: v for p, v in pages.items() if not p.startswith("LIVE ")}
    if gtm and local_pages:
        missing = sorted(p for p, v in local_pages.items() if not v["gtm"])
        if missing and len(missing) < len(local_pages):
            f.problems.append(f"{len(missing)} of {len(local_pages)} HTML pages have no GTM snippet: {', '.join(missing[:15])}{' …' if len(missing) > 15 else ''}")
        no_ns = sorted(p for p, v in local_pages.items() if v["gtm"] and not v["noscript"])
        if no_ns:
            f.problems.append(f"GTM <noscript> iframe missing on: {', '.join(no_ns[:10])}{' …' if len(no_ns) > 10 else ''}")
    if (gtm or ga4) and not f.flags.get("consent_default") and not f.flags.get("cookie_banner"):
        f.problems.append("No Consent Mode default and no known consent banner — decide consent mode (references/consent.md).")
    if (gtm or ga4) and not f.events and not f.gtag_events:
        f.problems.append("No custom events in code — conversions (leads, contact clicks, purchases) are probably not tracked.")
    if not f.gsc_tokens and not f.flags.get("gsc_html_file"):
        f.info.append("No Search Console meta/HTML-file verification in code (fine if verified by DNS, GA or GTM).")
    if url:
        if not f.live.get("sitemap"):
            f.problems.append("Live: no sitemap found (robots.txt, /sitemap.xml, /sitemap_index.xml, /wp-sitemap.xml).")
        elif not f.live.get("robots_sitemaps"):
            f.info.append(f"Live: sitemap exists ({f.live['sitemap']}) but robots.txt does not reference it.")
        for gid, c in f.live.get("gtm_containers", {}).items():
            if "error" in c:
                f.problems.append(f"Live: {gid} gtm.js returned {c['error']} — container missing or unpublished.")
            elif not c.get("ga4_ids") and not f.flags.get("gtag_loader"):
                f.problems.append(f"Live: container {gid} has no GA4 measurement ID inside — GA4 not configured in GTM (or not published).")
            if c.get("ua_ids"):
                f.problems.append(f"Live: container {gid} still contains UA tags {c['ua_ids']} — remove.")
    if f.packages.get("react-ga") or f.packages.get("react-ga4"):
        f.problems.append("Direct-GA npm package in use — replace with GTM + dataLayer events.")
    plugins = " ".join(f.wp_plugins + f.live.get("platform_markers", []))
    trackers = [n for n in ("Site Kit", "GTM4WP", "MonsterInsights", "ExactMetrics", "GA Google Analytics") if n in plugins]
    if len(trackers) > 1:
        f.problems.append(f"Several WordPress tracking plugins active ({', '.join(trackers)}) — keep one place that outputs tags.")


def to_dict(f):
    s = lambda d: {k: sorted(v) for k, v in d.items()}
    return {
        "ids": {k: s(v) for k, v in f.ids.items() if v},
        "flags": s(f.flags),
        "dataLayer_events": s(f.events),
        "gtag_events": s(f.gtag_events),
        "gtag_configs": s(f.gtag_configs),
        "search_console_meta_tokens": s(f.gsc_tokens),
        "packages": f.packages,
        "wordpress_plugins": f.wp_plugins,
        "html_pages": f.html_pages,
        "live": f.live,
        "problems": f.problems,
        "info": f.info,
    }


def short(locs, n=4):
    locs = sorted(locs)
    return ", ".join(locs[:n]) + (f" (+{len(locs) - n})" if len(locs) > n else "")


def print_report(f, folder, url):
    print(f"# Tracking audit — {folder or ''} {url or ''}".strip())
    labels = {"gtm_id": "GTM containers", "ga4_id": "GA4 measurement IDs", "ua_id": "Universal Analytics (dead)", "ads_id": "Google Ads IDs"}
    print("\n## IDs")
    any_id = False
    for k, label in labels.items():
        for i, locs in sorted(f.ids[k].items()):
            any_id = True
            print(f"- {label}: **{i}** — {short(locs)}")
    if not any_id:
        print("- none")
    print("\n## How tags load")
    names = {"gtm_loader": "GTM loader (gtm.js)", "gtm_noscript": "GTM noscript iframe", "gtag_loader": "gtag.js snippet (direct GA/Ads)",
             "analytics_js": "analytics.js (UA)", "consent_default": "Consent Mode default", "consent_update": "Consent update call",
             "cookie_banner": "Consent banner library", "meta_pixel": "Meta pixel", "tiktok": "TikTok pixel", "hotjar": "Hotjar",
             "clarity": "Microsoft Clarity", "linkedin": "LinkedIn Insight", "gsc_html_file": "Search Console HTML file",
             "sitemap_or_robots_file": "sitemap/robots files"}
    for k, label in names.items():
        if f.flags.get(k):
            print(f"- {label}: {short(f.flags[k])}")
    for c, locs in sorted(f.gtag_configs.items()):
        print(f"- gtag('config', '{c}'): {short(locs)}")
    if f.gsc_tokens:
        for t, locs in f.gsc_tokens.items():
            print(f"- google-site-verification meta: {t[:12]}… — {short(locs)}")
    if f.packages:
        print("\n## Packages")
        for p, label in f.packages.items():
            print(f"- {p}: {label}")
    if f.wp_plugins:
        print("\n## WordPress plugins")
        for p in f.wp_plugins:
            print(f"- {p}")
    print("\n## Events in code")
    if not f.events and not f.gtag_events:
        print("- none")
    for e, locs in sorted(f.events.items()):
        print(f"- dataLayer `{e}` — {short(locs, 3)}")
    for e, locs in sorted(f.gtag_events.items()):
        print(f"- gtag event `{e}` — {short(locs, 3)}")
    if f.html_pages:
        local = [p for p in f.html_pages if not p.startswith("LIVE ")]
        if local:
            with_gtm = sum(1 for p in local if f.html_pages[p]["gtm"])
            print(f"\n## Pages: {len(local)} HTML pages, {with_gtm} with GTM")
    if f.live:
        print("\n## Live")
        lv = f.live
        print(f"- Home: HTTP {lv.get('home_status')}")
        if lv.get("platform_markers"):
            print(f"- Platform markers: {', '.join(lv['platform_markers'])}")
        if "robots_status" in lv:
            print(f"- robots.txt: HTTP {lv['robots_status']}; Sitemap lines: {', '.join(lv['robots_sitemaps']) or 'none'}")
            print(f"- Sitemap found: {lv.get('sitemap') or 'no'}")
        for gid, c in lv.get("gtm_containers", {}).items():
            print(f"- {gid} contains: GA4 {c.get('ga4_ids') or '-'}; Ads {c.get('ads_ids') or '-'}; UA {c.get('ua_ids') or '-'}" if "error" not in c else f"- {gid}: {c['error']}")
    print("\n## Problems")
    for p in f.problems or ["none found"]:
        print(f"- {p}")
    if f.info:
        print("\n## Notes")
        for i in f.info:
            print(f"- {i}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?")
    ap.add_argument("--url")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if not a.folder and not a.url:
        ap.error("give a folder, --url, or both")
    if a.folder and not os.path.isdir(a.folder):
        ap.error(f"not a folder: {a.folder}")
    f = Findings()
    if a.folder:
        scan_folder(a.folder, f)
    if a.url:
        scan_live(a.url, f)
    analyse(f, a.folder, a.url)
    if a.json:
        json.dump(to_dict(f), sys.stdout, ensure_ascii=False, indent=2)
        print()
    else:
        print_report(f, a.folder, a.url)


if __name__ == "__main__":
    main()
