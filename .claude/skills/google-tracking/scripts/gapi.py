#!/usr/bin/env python3
"""Google Analytics 4 / Tag Manager / Search Console CLI for site tracking setup.

Plan-driven and idempotent: `apply`/`setup` read <site>/tracking-plan.json,
create or update only what is missing, and write new IDs back to the plan.
Always try --dry-run first.

Auth (first match wins):
  GOOGLE_SA_KEY_JSON              service-account key JSON *content* (cloud secrets)
  GOOGLE_APPLICATION_CREDENTIALS  path to a service-account key file
  Application Default Credentials (gcloud auth application-default login ...)

Requires: pip install google-auth requests

Commands:
  whoami
  ga4 accounts | streams --property P | key-events --property P | realtime --property P
  ga4 apply --plan FILE [--dry-run]
  gtm accounts | containers --account A
  gtm inspect (--plan FILE | --account A --container C) [--workspace NAME]
  gtm apply --plan FILE [--dry-run] [--publish]
  gsc sites | sitemaps --property SITE | inspect-url --property SITE --url URL
  gsc setup --plan FILE [--dry-run]
"""
import argparse
import datetime
import json
import os
import re
import sys
import urllib.parse

SCOPES = [
    "https://www.googleapis.com/auth/analytics.edit",
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/tagmanager.edit.containers",
    "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
    "https://www.googleapis.com/auth/tagmanager.publish",
    "https://www.googleapis.com/auth/tagmanager.manage.accounts",
    "https://www.googleapis.com/auth/webmasters",
    "https://www.googleapis.com/auth/siteverification",
]

GA_ADMIN = "https://analyticsadmin.googleapis.com/v1beta"
GA_ADMIN_ALPHA = "https://analyticsadmin.googleapis.com/v1alpha"
GA_DATA = "https://analyticsdata.googleapis.com/v1beta"
GTM = "https://tagmanager.googleapis.com/tagmanager/v2"
GSC = "https://www.googleapis.com/webmasters/v3"
GSC_V1 = "https://searchconsole.googleapis.com/v1"
SITEVER = "https://www.googleapis.com/siteVerification/v1"

# GTM built-in trigger IDs
TRIGGER_ALL_PAGES = "2147479553"
TRIGGER_INIT_ALL_PAGES = "2147479573"

class ApiError(Exception):
    pass


def enc(s):
    return urllib.parse.quote(s, safe="")


class Client:
    def __init__(self, dry_run=False):
        self.dry_run = dry_run
        try:
            import google.auth
            from google.auth.transport.requests import AuthorizedSession
            from google.oauth2 import service_account
        except ImportError:
            sys.exit("Missing dependencies: pip install google-auth requests")
        raw = os.environ.get("GOOGLE_SA_KEY_JSON")
        path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if raw:
            creds = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=SCOPES)
        elif path and os.path.exists(path) and json.load(open(path)).get("type") == "service_account":
            creds = service_account.Credentials.from_service_account_file(path, scopes=SCOPES)
        else:
            creds, _ = google.auth.default(scopes=SCOPES)
        self.identity = getattr(creds, "service_account_email", None) or "application-default user"
        self.s = AuthorizedSession(creds)

    def call(self, method, url, body=None, params=None, mutate=False):
        if mutate and self.dry_run:
            print(f"  [dry-run] {method} {url.split('googleapis.com')[-1]}" + (f"  {json.dumps(body, ensure_ascii=False)[:300]}" if body else ""))
            return {}
        r = self.s.request(method, url, json=body, params=params, timeout=60)
        if r.status_code >= 400:
            raise ApiError(self.explain(r))
        return r.json() if r.content else {}

    def paged(self, url, key, params=None):
        params = dict(params or {})
        while True:
            data = self.call("GET", url, params=params)
            yield from data.get(key, [])
            tok = data.get("nextPageToken")
            if not tok:
                return
            params["pageToken"] = tok

    def explain(self, r):
        try:
            err = r.json().get("error", {})
            msg = err.get("message", r.text)
        except ValueError:
            msg = r.text
        hint = ""
        if "has not been used in project" in msg or "SERVICE_DISABLED" in msg or "is disabled" in msg:
            hint = "\n  → Enable this API in the Google Cloud project of the service account (see references/google-apis.md)."
        elif r.status_code in (401, 403):
            hint = (f"\n  → {self.identity} has no access here. Add it as a user: GA4 Admin → Account access management (Editor), "
                    "GTM Admin → User management (account: User/Admin, container: Publish), Search Console → Settings → Users (Owner).")
        return f"HTTP {r.status_code}: {msg}{hint}"


# ---------------------------------------------------------------- plan file

def load_plan(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def save_plan(path, plan, client):
    if client.dry_run:
        return
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(plan, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"  plan updated: {path}")


def digits(s):
    return re.sub(r"\D", "", str(s or ""))


def last(name):
    return name.rsplit("/", 1)[-1] if name else ""


# ---------------------------------------------------------------- whoami

def cmd_whoami(c, a):
    print(f"Identity: {c.identity}")
    for label, fn in (
        ("GA4 accounts", lambda: [x.get("displayName") for x in c.paged(f"{GA_ADMIN}/accountSummaries", "accountSummaries")]),
        ("GTM accounts", lambda: [x.get("name") for x in c.call("GET", f"{GTM}/accounts").get("account", [])]),
        ("Search Console sites", lambda: [x.get("siteUrl") for x in c.call("GET", f"{GSC}/sites").get("siteEntry", [])]),
    ):
        try:
            items = fn()
            print(f"- {label}: {len(items)}" + (f" — {', '.join(map(str, items[:8]))}" if items else " (add the identity above as a user)"))
        except ApiError as e:
            print(f"- {label}: ERROR {e}")


# ---------------------------------------------------------------- GA4

def ga4_accounts(c, a):
    for acc in c.paged(f"{GA_ADMIN}/accountSummaries", "accountSummaries"):
        print(f"{last(acc['account'])}  {acc.get('displayName')}")
        for p in acc.get("propertySummaries", []):
            print(f"   property {last(p['property'])}  {p.get('displayName')}")


def ga4_streams(c, a):
    for s in c.paged(f"{GA_ADMIN}/properties/{a.property}/dataStreams", "dataStreams"):
        w = s.get("webStreamData", {})
        print(f"{last(s['name'])}  {s.get('type')}  {s.get('displayName')}  {w.get('measurementId', '')}  {w.get('defaultUri', '')}")


def ga4_key_events(c, a):
    for k in c.paged(f"{GA_ADMIN}/properties/{a.property}/keyEvents", "keyEvents"):
        print(f"{k['eventName']}  counting={k.get('countingMethod')}  custom={k.get('custom')}")


def ga4_realtime(c, a):
    body = {"dimensions": [{"name": "eventName"}], "metrics": [{"name": "eventCount"}], "limit": 100,
            "minuteRanges": [{"startMinutesAgo": min(a.minutes, 29), "endMinutesAgo": 0}]}
    data = c.call("POST", f"{GA_DATA}/properties/{a.property}:runRealtimeReport", body)
    rows = data.get("rows", [])
    print(f"Events in the last {min(a.minutes, 29) + 1} minutes:" if rows else "No events in realtime (deployed? consent granted? ad blocker?)")
    for r in rows:
        print(f"  {r['dimensionValues'][0]['value']:30} {r['metricValues'][0]['value']}")


def ga4_apply(c, a):
    plan = load_plan(a.plan)
    site, ga = plan["site"], plan.setdefault("google", {}).setdefault("ga4", {})
    pid = digits(ga.get("propertyId"))

    if not pid:
        acc = digits(ga.get("accountId"))
        if not acc:
            sys.exit("ga4.propertyId and ga4.accountId are both empty — run `ga4 accounts` and fill accountId (or an existing propertyId).")
        print(f"• create GA4 property '{site['name']}' in account {acc}")
        prop = c.call("POST", f"{GA_ADMIN}/properties", {
            "parent": f"accounts/{acc}", "displayName": site["name"],
            "timeZone": site.get("timeZone", "Asia/Jerusalem"), "currencyCode": site.get("currency", "ILS"),
        }, mutate=True)
        pid = last(prop.get("name", "")) or "<new>"
        ga["propertyId"] = pid
    else:
        print(f"• property {pid} exists")

    streams = [] if pid == "<new>" else [s for s in c.paged(f"{GA_ADMIN}/properties/{pid}/dataStreams", "dataStreams") if s.get("type") == "WEB_DATA_STREAM"]
    host = urllib.parse.urlparse(site["url"]).hostname or ""
    bare = host.removeprefix("www.")
    stream = None
    if ga.get("streamId"):
        stream = next((s for s in streams if last(s["name"]) == str(ga["streamId"])), None)
    if not stream and ga.get("measurementId"):
        stream = next((s for s in streams if s.get("webStreamData", {}).get("measurementId") == ga["measurementId"]), None)
    if not stream:
        stream = next((s for s in streams if bare and bare in s.get("webStreamData", {}).get("defaultUri", "")), None)
    if stream:
        print(f"• web stream {last(stream['name'])} {stream['webStreamData'].get('measurementId')} exists")
    else:
        print(f"• create web stream for {site['url']}")
        stream = c.call("POST", f"{GA_ADMIN}/properties/{pid}/dataStreams", {
            "type": "WEB_DATA_STREAM", "displayName": site["name"], "webStreamData": {"defaultUri": site["url"]},
        }, mutate=True)
    if stream:
        ga["streamId"] = last(stream.get("name", "")) or ga.get("streamId", "")
        ga["measurementId"] = stream.get("webStreamData", {}).get("measurementId") or ga.get("measurementId", "")

    existing = set() if pid == "<new>" else {k["eventName"] for k in c.paged(f"{GA_ADMIN}/properties/{pid}/keyEvents", "keyEvents")}
    wanted = [e for e in plan.get("events", []) if e.get("keyEvent")]
    for e in wanted:
        if e["name"] in existing:
            print(f"• key event {e['name']} exists")
        else:
            print(f"• mark {e['name']} as key event")
            c.call("POST", f"{GA_ADMIN}/properties/{pid}/keyEvents",
                   {"eventName": e["name"], "countingMethod": e.get("counting", "ONCE_PER_EVENT")}, mutate=True)
    extra = existing - {e["name"] for e in wanted} - {"purchase", "first_open", "in_app_purchase", "app_store_subscription_convert", "app_store_subscription_renew"}
    if extra:
        print(f"  note: key events in GA4 not in plan (left as is): {', '.join(sorted(extra))}")

    dims = {d["parameterName"] for d in c.paged(f"{GA_ADMIN}/properties/{pid}/customDimensions", "customDimensions")} if pid != "<new>" else set()
    for d in plan.get("customDimensions", []):
        if d["parameter"] in dims:
            print(f"• custom dimension {d['parameter']} exists")
        else:
            print(f"• create custom dimension {d['parameter']}")
            c.call("POST", f"{GA_ADMIN}/properties/{pid}/customDimensions", {
                "parameterName": d["parameter"], "displayName": d.get("displayName", d["parameter"]), "scope": d.get("scope", "EVENT"),
            }, mutate=True)

    want_ret = ga.get("dataRetention", "FOURTEEN_MONTHS")
    if pid != "<new>":
        ret = c.call("GET", f"{GA_ADMIN}/properties/{pid}/dataRetentionSettings")
        if ret.get("eventDataRetention") != want_ret:
            print(f"• data retention {ret.get('eventDataRetention')} → {want_ret}")
            c.call("PATCH", f"{GA_ADMIN}/properties/{pid}/dataRetentionSettings", {"eventDataRetention": want_ret},
                   params={"updateMask": "eventDataRetention"}, mutate=True)
        else:
            print(f"• data retention {want_ret}")

    if stream and ga.get("streamId") and pid != "<new>":
        url = f"{GA_ADMIN_ALPHA}/properties/{pid}/dataStreams/{ga['streamId']}/enhancedMeasurementSettings"
        try:
            em = c.call("GET", url)
            print(f"• enhanced measurement: on={em.get('streamEnabled')} history-page-views={em.get('pageChangesEnabled')} "
                  f"outbound={em.get('outboundClicksEnabled')} forms={em.get('formInteractionsEnabled')}")
            if site.get("stack", "").startswith(("vite", "next")) and not em.get("pageChangesEnabled"):
                print("• SPA: enable page views on browser history changes")
                c.call("PATCH", url, {"pageChangesEnabled": True}, params={"updateMask": "pageChangesEnabled"}, mutate=True)
        except ApiError as e:
            print(f"  note: could not read enhanced measurement (v1alpha): {str(e)[:160]}")

    ads = plan["google"].get("ads", {})
    if digits(ads.get("customerId")) and pid != "<new>":
        cid = digits(ads["customerId"])
        links = [l.get("customerId") for l in c.paged(f"{GA_ADMIN}/properties/{pid}/googleAdsLinks", "googleAdsLinks")]
        if cid in links:
            print(f"• Google Ads link {cid} exists")
        else:
            print(f"• link Google Ads {cid}")
            try:
                c.call("POST", f"{GA_ADMIN}/properties/{pid}/googleAdsLinks", {"customerId": cid}, mutate=True)
            except ApiError as e:
                print(f"  ! Ads link failed (needs admin on the Ads account too) — add to manual checklist: {str(e)[:200]}")

    save_plan(a.plan, plan, c)
    print("Manual: link Search Console in GA4 (Admin → Product links → Search Console links) — no API exists for it.")


# ---------------------------------------------------------------- GTM

def p_tpl(key, value):
    return {"type": "template", "key": key, "value": str(value)}


def p_bool(key, value):
    return {"type": "boolean", "key": key, "value": "true" if value else "false"}


def p_table(key, rows, kname, vname):
    return {"type": "list", "key": key, "list": [
        {"type": "map", "map": [p_tpl(kname, k), p_tpl(vname, v)]} for k, v in rows]}


def desired_gtm(plan):
    ga = plan["google"].get("ga4", {})
    mid = ga.get("measurementId")
    if not mid:
        sys.exit("ga4.measurementId is empty — run `ga4 apply` first or fill it in the plan.")
    events = plan.get("events", [])
    params = sorted({p for e in events for p in e.get("params", [])})
    ads = plan["google"].get("ads", {})
    aw = digits(ads.get("conversionId"))
    for conv in ads.get("conversions", []) if aw else []:
        ev = next((e for e in events if e["name"] == conv["event"]), {})
        params = sorted(set(params) | ({"value", "currency", "transaction_id"} & set(ev.get("params", []))))

    variables = [{"name": f"DLV - {p}", "type": "v", "parameter": [
        {"type": "integer", "key": "dataLayerVersion", "value": "2"}, p_bool("setDefaultValue", False), p_tpl("name", p)]}
        for p in params]
    trigger_events = sorted({e["name"] for e in events} | ({cv["event"] for cv in ads.get("conversions", [])} if aw else set()))
    triggers = [{"name": f"CE - {n}", "type": "customEvent", "customEventFilter": [
        {"type": "equals", "parameter": [p_tpl("arg0", "{{_event}}"), p_tpl("arg1", n)]}]} for n in trigger_events]

    tags = [{"name": "GA4 - Google Tag", "type": "googtag", "parameter": [p_tpl("tagId", mid)],
             "firingTriggerId": [TRIGGER_INIT_ALL_PAGES], "_kind": ("googtag", mid)}]
    for e in events:
        prm = [p_tpl("eventName", e["name"]), p_tpl("measurementIdOverride", mid)]
        if e.get("params"):
            prm.append(p_table("eventSettingsTable", [(p, "{{DLV - %s}}" % p) for p in e["params"]], "parameter", "parameterValue"))
        if e.get("ecommerce"):
            prm += [p_bool("sendEcommerceData", True), p_tpl("getEcommerceDataFrom", "dataLayer")]
        tags.append({"name": f"GA4 - Event - {e['name']}", "type": "gaawe", "parameter": prm,
                     "firingTriggerId": [f"@CE - {e['name']}"], "_kind": ("gaawe", e["name"])})
    if aw:
        tags.append({"name": "Ads - Conversion Linker", "type": "gclidw", "parameter": [],
                     "firingTriggerId": [TRIGGER_ALL_PAGES], "_kind": ("gclidw", "")})
        for conv in ads.get("conversions", []):
            if not conv.get("label"):
                print(f"  note: ads conversion for {conv['event']} has no label — skipped")
                continue
            ev = next((e for e in events if e["name"] == conv["event"]), {})
            prm = [p_tpl("conversionId", aw), p_tpl("conversionLabel", conv["label"])]
            if "value" in ev.get("params", []):
                prm += [p_tpl("conversionValue", "{{DLV - value}}"), p_tpl("currencyCode", "{{DLV - currency}}")]
            if "transaction_id" in ev.get("params", []):
                prm.append(p_tpl("orderId", "{{DLV - transaction_id}}"))
            tags.append({"name": f"Ads - Conversion - {conv['event']}", "type": "awct", "parameter": prm,
                         "firingTriggerId": [f"@CE - {conv['event']}"], "_kind": ("awct", conv["label"])})
    return variables, triggers, tags


def norm_params(params):
    def n(p):
        out = {"key": p.get("key"), "type": (p.get("type") or "").lower(), "value": p.get("value")}
        if p.get("list"):
            out["list"] = [n(x) for x in p["list"]]
        if p.get("map"):
            out["map"] = sorted((n(x) for x in p["map"]), key=lambda x: str(x.get("key")))
        return out
    return sorted((n(p) for p in params or []), key=lambda x: str(x.get("key")))


def param_value(item, key):
    return next((p.get("value") for p in item.get("parameter", []) if p.get("key") == key), None)


def gtm_container(c, plan, create=True):
    g = plan["google"].setdefault("gtm", {})
    acc = digits(g.get("accountId"))
    if not acc:
        sys.exit("gtm.accountId is empty — run `gtm accounts` and fill it in the plan.")
    cid = digits(g.get("containerId"))
    if cid:
        return acc, cid
    conts = c.call("GET", f"{GTM}/accounts/{acc}/containers").get("container", [])
    if g.get("publicId"):
        hit = next((x for x in conts if x.get("publicId") == g["publicId"]), None)
        if not hit:
            sys.exit(f"{g['publicId']} not found in GTM account {acc} (or no access).")
        g["containerId"] = hit["containerId"]
        return acc, hit["containerId"]
    if not create:
        sys.exit("No container in plan.")
    print(f"• create GTM container '{plan['site']['name']}'")
    new = c.call("POST", f"{GTM}/accounts/{acc}/containers", {"name": plan["site"]["name"], "usageContext": ["web"]}, mutate=True)
    g["containerId"], g["publicId"] = new.get("containerId", "<new>"), new.get("publicId", "")
    return acc, g["containerId"]


def gtm_workspace(c, acc, cid, name):
    base = f"{GTM}/accounts/{acc}/containers/{cid}"
    wss = c.call("GET", f"{base}/workspaces").get("workspace", []) if cid != "<new>" else []
    ws = next((w for w in wss if w["name"] == name), None)
    if ws:
        return f"{base}/workspaces/{ws['workspaceId']}"
    if wss and name == "Default Workspace":
        return f"{base}/workspaces/{wss[0]['workspaceId']}"
    print(f"• create workspace '{name}'")
    ws = c.call("POST", f"{base}/workspaces", {"name": name}, mutate=True)
    return f"{base}/workspaces/{ws.get('workspaceId', '<new>')}"


def gtm_accounts(c, a):
    for acc in c.call("GET", f"{GTM}/accounts").get("account", []):
        print(f"{acc['accountId']}  {acc['name']}")


def gtm_containers(c, a):
    for x in c.call("GET", f"{GTM}/accounts/{a.account}/containers").get("container", []):
        print(f"{x['containerId']}  {x.get('publicId')}  {x['name']}  {x.get('usageContext')}")


def gtm_inspect(c, a):
    if a.plan:
        plan = load_plan(a.plan)
        acc, cid = gtm_container(c, plan, create=False)
        wsname = a.workspace or plan["google"]["gtm"].get("workspace", "Default Workspace")
    else:
        acc, cid, wsname = a.account, a.container, a.workspace or "Default Workspace"
    base = f"{GTM}/accounts/{acc}/containers/{cid}"
    try:
        live = c.call("GET", f"{base}/versions:live")
        print(f"Live version {live.get('containerVersionId')} '{live.get('name', '')}' — "
              f"{len(live.get('tag', []))} tags, {len(live.get('trigger', []))} triggers, {len(live.get('variable', []))} variables")
    except ApiError as e:
        print(f"Live version: none ({str(e)[:80]})")
    ws = gtm_workspace(c, acc, cid, wsname)
    trig = {t["triggerId"]: t["name"] for t in c.call("GET", f"{ws}/triggers").get("trigger", [])}
    trig.update({TRIGGER_ALL_PAGES: "All Pages", TRIGGER_INIT_ALL_PAGES: "Initialization - All Pages", "2147479572": "Consent Initialization"})
    print(f"\nWorkspace '{wsname}' tags:")
    for t in c.call("GET", f"{ws}/tags").get("tag", []):
        ident = param_value(t, "tagId") or param_value(t, "measurementIdOverride") or param_value(t, "measurementId") or param_value(t, "trackingId") or param_value(t, "conversionId") or ""
        evn = param_value(t, "eventName") or ""
        fires = ", ".join(trig.get(x, x) for x in t.get("firingTriggerId", []))
        paused = " [PAUSED]" if t.get("paused") else ""
        print(f"  {t['type']:8} {t['name']}{paused}  {ident} {evn}  ← {fires}")
    print("\nTriggers:")
    for tid, name in sorted(trig.items(), key=lambda x: x[1]):
        if not tid.startswith("21474"):
            print(f"  {name}")
    print("\nVariables:")
    for v in c.call("GET", f"{ws}/variables").get("variable", []):
        print(f"  {v['type']:6} {v['name']}  {param_value(v, 'name') or ''}")
    st = c.call("GET", f"{ws}/status")
    if st.get("workspaceChange"):
        print(f"\nUnpublished changes in workspace: {len(st['workspaceChange'])}")


def gtm_apply(c, a):
    plan = load_plan(a.plan)
    acc, cid = gtm_container(c, plan)
    ws = gtm_workspace(c, acc, cid, plan["google"]["gtm"].get("workspace", "Default Workspace"))
    variables, triggers, tags = desired_gtm(plan)
    new_ws = "<new>" in ws
    get = (lambda kind, key: []) if new_ws else (lambda kind, key: c.call("GET", f"{ws}/{kind}").get(key, []))
    changed = 0

    def upsert(kind, key, idkey, want, existing):
        nonlocal changed
        cur = next((x for x in existing if x["name"] == want["name"]), None)
        body = {k: v for k, v in want.items() if not k.startswith("_")}
        if cur is None:
            print(f"• create {kind[:-1]} '{want['name']}'")
            res = c.call("POST", f"{ws}/{kind}", body, mutate=True)
            changed += 1
            return res.get(idkey, f"@{want['name']}")
        same = cur.get("type") == body.get("type") and norm_params(cur.get("parameter")) == norm_params(body.get("parameter"))
        if kind == "triggers":
            same = same and json.dumps(cur.get("customEventFilter"), sort_keys=True).lower() == json.dumps(body.get("customEventFilter"), sort_keys=True).lower()
        if kind == "tags":
            same = same and sorted(cur.get("firingTriggerId", [])) == sorted(body.get("firingTriggerId", []))
        if same:
            print(f"• {kind[:-1]} '{want['name']}' up to date")
        else:
            print(f"• update {kind[:-1]} '{want['name']}'")
            c.call("PUT", f"{ws}/{kind}/{cur[idkey]}", {**cur, **body}, mutate=True)
            changed += 1
        return cur[idkey]

    ex_vars = get("variables", "variable")
    for v in variables:
        upsert("variables", "variable", "variableId", v, ex_vars)

    ex_trig = get("triggers", "trigger")
    trig_ids = {t["name"]: upsert("triggers", "trigger", "triggerId", t, ex_trig) for t in triggers}

    ex_tags = get("tags", "tag")
    for t in ex_tags:
        if t["type"] in ("ua", "gaawc") and not t.get("paused"):
            print(f"  ! legacy tag '{t['name']}' ({t['type']}) — UA/old GA4 config; pause or delete it in GTM after review")
    for t in tags:
        kind, ident = t["_kind"]
        twin = None
        if not any(x["name"] == t["name"] for x in ex_tags):  # only look for look-alikes before our own tag exists
            for x in ex_tags:
                if x["name"] == t["name"] or x["type"] != kind or x.get("paused"):
                    continue
                if kind == "googtag" and param_value(x, "tagId") == ident:
                    twin = x
                elif kind == "gaawe" and param_value(x, "eventName") == ident:
                    twin = x
                elif kind == "gclidw":
                    twin = x
                elif kind == "awct" and param_value(x, "conversionLabel") == ident:
                    twin = x
        if twin:
            print(f"• '{t['name']}' skipped — existing tag '{twin['name']}' already does this (avoids double sending)")
            continue
        t["firingTriggerId"] = [trig_ids.get(x[1:], x) if x.startswith("@") else x for x in t["firingTriggerId"]]
        upsert("tags", "tag", "tagId", t, ex_tags)

    save_plan(a.plan, plan, c)
    if not changed:
        print("No changes.")
    if a.publish and (changed or a.force_publish):
        if c.dry_run:
            print("  [dry-run] would create a version and publish it")
            return
        ver = c.call("POST", f"{ws}:create_version", {
            "name": f"tracking {datetime.date.today().isoformat()}", "notes": "Created by google-tracking skill (gapi.py gtm apply)"}, mutate=True)
        if ver.get("compilerError"):
            sys.exit("GTM compiler error — open the workspace in GTM to see it; nothing was published.")
        cv = ver.get("containerVersion", {})
        c.call("POST", f"{GTM}/accounts/{acc}/containers/{cid}/versions/{cv['containerVersionId']}:publish", mutate=True)
        print(f"• published version {cv['containerVersionId']} ({plan['google']['gtm'].get('publicId', '')})")
    elif changed:
        print("Changes are saved in the workspace but NOT live. Rerun with --publish, or publish in the GTM UI after Preview.")


# ---------------------------------------------------------------- Search Console

def gsc_sites(c, a):
    for s in c.call("GET", f"{GSC}/sites").get("siteEntry", []):
        print(f"{s['siteUrl']}  {s['permissionLevel']}")


def gsc_sitemaps(c, a):
    for s in c.call("GET", f"{GSC}/sites/{enc(a.property)}/sitemaps").get("sitemap", []):
        print(f"{s['path']}  submitted={s.get('lastSubmitted', '')}  downloaded={s.get('lastDownloaded', '')}  "
              f"errors={s.get('errors', 0)} warnings={s.get('warnings', 0)}")


def gsc_inspect_url(c, a):
    r = c.call("POST", f"{GSC_V1}/urlInspection/index:inspect", {"inspectionUrl": a.url, "siteUrl": a.property})
    idx = r.get("inspectionResult", {}).get("indexStatusResult", {})
    for k in ("verdict", "coverageState", "indexingState", "lastCrawlTime", "googleCanonical", "robotsTxtState", "pageFetchState"):
        print(f"{k:16} {idx.get(k, '')}")


def gsc_setup(c, a):
    plan = load_plan(a.plan)
    sc = plan["google"].setdefault("searchConsole", {})
    prop = sc.get("property") or plan["site"]["url"].rstrip("/") + "/"
    sc["property"] = prop
    domain = prop.startswith("sc-domain:")
    sites = {s["siteUrl"]: s["permissionLevel"] for s in c.call("GET", f"{GSC}/sites").get("siteEntry", [])}
    level = sites.get(prop)

    if level in ("siteOwner", "siteFullUser"):
        print(f"• {prop}: {level}")
    else:
        site = {"type": "INET_DOMAIN", "identifier": prop.split(":", 1)[1]} if domain else {"type": "SITE", "identifier": prop}
        method = sc.get("verification") or ("DNS_TXT" if domain else "META")
        if method == "existing":
            sys.exit(f"{prop} is marked as already verified, but {c.identity} has no access. "
                     "Add it in Search Console → Settings → Users and permissions (Owner), then rerun.")
        if domain and method != "DNS_TXT":
            sys.exit("Domain properties (sc-domain:) can only be verified with DNS_TXT.")
        if method in ("DNS_TXT", "META", "FILE"):
            tok = c.call("POST", f"{SITEVER}/token", {"site": site, "verificationMethod": method}, mutate=True).get("token", "<token>")
            if method == "DNS_TXT":
                print(f"• add this DNS TXT record on {site['identifier']} (host @):\n    {tok}")
            elif method == "META":
                print(f"• add to the home page <head>:\n    {tok}\n  (inject_gtm.py --meta-verification <content value> does it for static sites)")
            else:
                print(f"• upload a file named {tok} to the site root, containing exactly: google-site-verification: {tok}")
        print(f"• verify with {method}")
        try:
            res = c.call("POST", f"{SITEVER}/webResource", {"site": site}, params={"verificationMethod": method}, mutate=True)
        except ApiError as e:
            print(f"  not verified yet: {str(e)[:200]}\n  → deploy the token above (DNS can take a while), then rerun `gsc setup`.")
            save_plan(a.plan, plan, c)
            return
        owners = [o for o in sc.get("owners", []) if o]
        if owners and res.get("id"):
            cur = c.call("GET", f"{SITEVER}/webResource/{enc(res['id'])}")
            merged = sorted(set(cur.get("owners", [])) | set(owners))
            if merged != sorted(cur.get("owners", [])):
                print(f"• add owners {', '.join(owners)} (so the property doesn't belong only to the service account)")
                c.call("PUT", f"{SITEVER}/webResource/{enc(res['id'])}", {**cur, "owners": merged}, mutate=True)
        elif not owners:
            print("  ! no searchConsole.owners in plan — only the service account owns this property. Add the client's Google email.")
        print(f"• add {prop} to Search Console")
        c.call("PUT", f"{GSC}/sites/{enc(prop)}", mutate=True)
        sc["verification"] = method

    sm = sc.get("sitemap")
    if sm:
        existing = [] if (not level and c.dry_run) else [s["path"] for s in c.call("GET", f"{GSC}/sites/{enc(prop)}/sitemaps").get("sitemap", [])]
        if sm in existing:
            print(f"• sitemap {sm} already submitted")
        else:
            print(f"• submit sitemap {sm}")
            c.call("PUT", f"{GSC}/sites/{enc(prop)}/sitemaps/{enc(sm)}", mutate=True)
    else:
        print("  ! no searchConsole.sitemap in plan — create one (references/stacks.md) and add it.")
    save_plan(a.plan, plan, c)


# ---------------------------------------------------------------- CLI

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="print mutations instead of sending them")
    sub = ap.add_subparsers(dest="area", required=True)

    sub.add_parser("whoami").set_defaults(fn=cmd_whoami)

    def add(parent, name, fn, *args):
        p = parent.add_parser(name)
        p.add_argument("--dry-run", action="store_true", default=argparse.SUPPRESS)
        for arg in args:
            p.add_argument(arg, required=arg not in ("--workspace", "--minutes", "--plan", "--account", "--container"))
        p.set_defaults(fn=fn)
        return p

    ga = sub.add_parser("ga4").add_subparsers(dest="cmd", required=True)
    add(ga, "accounts", ga4_accounts)
    add(ga, "streams", ga4_streams, "--property")
    add(ga, "key-events", ga4_key_events, "--property")
    add(ga, "realtime", ga4_realtime, "--property").add_argument("--minutes", type=int, default=29)
    add(ga, "apply", ga4_apply, "--plan").set_defaults(plan_required=True)

    gt = sub.add_parser("gtm").add_subparsers(dest="cmd", required=True)
    add(gt, "accounts", gtm_accounts)
    add(gt, "containers", gtm_containers, "--account")
    add(gt, "inspect", gtm_inspect, "--plan", "--account", "--container", "--workspace")
    p = add(gt, "apply", gtm_apply, "--plan")
    p.add_argument("--publish", action="store_true")
    p.add_argument("--force-publish", action="store_true", help="publish even if apply changed nothing")
    p.set_defaults(plan_required=True)

    gs = sub.add_parser("gsc").add_subparsers(dest="cmd", required=True)
    add(gs, "sites", gsc_sites)
    add(gs, "sitemaps", gsc_sitemaps, "--property")
    add(gs, "inspect-url", gsc_inspect_url, "--property", "--url")
    add(gs, "setup", gsc_setup, "--plan").set_defaults(plan_required=True)

    a = ap.parse_args()
    if getattr(a, "plan_required", False) and not a.plan:
        ap.error("--plan is required")
    if a.area == "gtm" and a.cmd == "inspect" and not a.plan and not (a.account and a.container):
        ap.error("gtm inspect needs --plan or --account and --container")
    c = Client(dry_run=a.dry_run)
    try:
        a.fn(c, a)
    except ApiError as e:
        sys.exit(f"ERROR {e}")


if __name__ == "__main__":
    main()
