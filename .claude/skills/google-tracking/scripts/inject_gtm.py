#!/usr/bin/env python3
"""Insert (or replace) the GTM container snippet in every HTML page of a folder.

Usage:
  inject_gtm.py <folder> --gtm GTM-XXXXXXX [--consent] [--helper /tracking.js]
                [--meta-verification TOKEN] [--dry-run] [--remove]

- Head block goes right after <head ...> (before other scripts, as Google asks),
  body block right after <body ...>. Both sit between marker comments
  <!-- tracking:head:start --> ... <!-- tracking:head:end --> so re-running
  replaces them instead of duplicating.
- --consent adds Consent Mode v2 defaults before GTM: denied in EEA/UK/CH,
  granted elsewhere. Add --deny-all to deny everywhere until the banner
  grants consent (see references/consent.md).
- --helper adds <script src="..." defer> for assets/tracking.js.
- --meta-verification adds the Search Console verification meta tag (home page
  only: index.html at the folder root).
- Never touches existing hard-coded gtag/GTM code outside the markers; it
  warns about it instead, because removing it safely is a judgement call.
Standard library only.
"""
import argparse
import os
import re
import sys

SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "out", "vendor"}

EEA = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IS", "IE", "IT", "LV", "LI",
       "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB", "CH"]

CONSENT = """<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('consent', 'default', {{
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    analytics_storage: 'denied', wait_for_update: 500{regions}
  }});
{rest}  gtag('set', 'ads_data_redaction', true);
</script>"""

CONSENT_REST_GRANTED = """  gtag('consent', 'default', {
    ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted',
    analytics_storage: 'granted'
  });
"""

GTM_HEAD = """<script>(function(w,d,s,l,i){{w[l]=w[l]||[];w[l].push({{'gtm.start':
new Date().getTime(),event:'gtm.js'}});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
}})(window,document,'script','dataLayer','{gtm}');</script>"""

GTM_BODY = """<noscript><iframe src="https://www.googletagmanager.com/ns.html?id={gtm}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>"""

HEAD_RX = re.compile(r"(<head\b[^>]*>)", re.I)
BODY_RX = re.compile(r"(<body\b[^>]*>)", re.I)
BLOCK_RX = lambda name: re.compile(r"\n?[ \t]*<!-- tracking:%s:start -->.*?<!-- tracking:%s:end -->[ \t]*" % (name, name), re.S)
LEGACY_RX = re.compile(r"googletagmanager\.com/(gtag/js|gtm\.js)|google-analytics\.com/(analytics|ga)\.js|gtm\.start")


def head_block(a):
    parts = []
    if a.meta_token_here:
        parts.append(f'<meta name="google-site-verification" content="{a.meta_verification}" />')
    if a.consent:
        regions = "" if a.deny_all else ",\n    region: [" + ", ".join(f"'{c}'" for c in EEA) + "]"
        parts.append(CONSENT.format(regions=regions, rest="" if a.deny_all else CONSENT_REST_GRANTED))
    parts.append(GTM_HEAD.format(gtm=a.gtm))
    if a.helper:
        parts.append(f'<script src="{a.helper}" defer></script>')
    return "<!-- tracking:head:start -->\n" + "\n".join(parts) + "\n<!-- tracking:head:end -->"


def body_block(a):
    return "<!-- tracking:body:start -->\n" + GTM_BODY.format(gtm=a.gtm) + "\n<!-- tracking:body:end -->"


def process(path, a, root):
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    if not HEAD_RX.search(src) or not BODY_RX.search(src):
        return "skip (no <head> or <body>)", None
    out = BLOCK_RX("head").sub("", src)
    out = BLOCK_RX("body").sub("", out)
    warn = None
    if LEGACY_RX.search(out):
        warn = "has hard-coded gtag/GTM/UA code outside the markers — review and remove manually"
    if not a.remove:
        a.meta_token_here = bool(a.meta_verification) and os.path.abspath(path) == os.path.abspath(os.path.join(root, "index.html"))
        out = HEAD_RX.sub(lambda m: m.group(1) + "\n" + head_block(a), out, count=1)
        out = BODY_RX.sub(lambda m: m.group(1) + "\n" + body_block(a), out, count=1)
    if out == src:
        return "unchanged", warn
    if not a.dry_run:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(out)
    return ("would update" if a.dry_run else "updated"), warn


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder")
    ap.add_argument("--gtm", help="GTM-XXXXXXX (required unless --remove)")
    ap.add_argument("--consent", action="store_true", help="add Consent Mode v2 defaults before GTM")
    ap.add_argument("--deny-all", action="store_true", help="with --consent: denied everywhere, not only EEA/UK/CH")
    ap.add_argument("--helper", help="src for tracking.js, e.g. /tracking.js or js/tracking.js")
    ap.add_argument("--meta-verification", help="Search Console META token")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--remove", action="store_true", help="remove the marker blocks")
    a = ap.parse_args()
    if not a.remove and not (a.gtm and re.fullmatch(r"GTM-[A-Z0-9]{4,9}", a.gtm)):
        ap.error("--gtm GTM-XXXXXXX is required")
    a.meta_token_here = False
    pages = 0
    for dirpath, dirnames, filenames in os.walk(a.folder):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for name in sorted(filenames):
            if not name.lower().endswith((".html", ".htm")):
                continue
            path = os.path.join(dirpath, name)
            status, warn = process(path, a, a.folder)
            pages += 1
            print(f"{status:14} {os.path.relpath(path, a.folder)}" + (f"  ⚠ {warn}" if warn else ""))
    if not pages:
        print("no HTML files found", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
