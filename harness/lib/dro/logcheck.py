import sys, json, collections
from urllib.parse import urlparse
# usage: logcheck.py <journey.json> <out.json> <api.stdout> <api.stderr> <web.stdout> <web.stderr>
jf, outf, *files = sys.argv[1:]
journey = json.load(open(jf)); why = []; rows = {"api": [], "web": []}; bad_lines = 0; total = 0
for name, path in zip(("api", "api", "web", "web"), files):
    for line in open(path, errors="replace"):
        if not line.strip(): continue
        total += 1
        try:
            o = json.loads(line)
            if not isinstance(o, dict): raise ValueError
        except Exception:
            bad_lines += 1; why.append(f"{name}: non-JSON line {line[:80]!r}"); continue
        miss = [k for k in ("time", "level", "event", "service") if k not in o]
        if miss: why.append(f"{name}: line {o.get('event')} missing {miss}")
        rows[name].append(o)
need = ("method", "route", "status", "durationMs", "requestId")
for name in rows:
    comp = [o for o in rows[name] if o.get("event") == "request.complete"]
    if not comp: why.append(f"{name}: no request.complete records")
    for o in comp:
        if any(k not in o for k in need): why.append(f"{name}: request.complete missing fields {o}"); break
lo, hi = journey["start"], journey["end"]
def inwin(o): return lo <= o["time"] <= hi[:-1] + "9Z" or (lo <= o["time"])  # window start; end checked below
win_api = [o for o in rows["api"] if o.get("event") == "request.complete" and lo <= o["time"] <= hi and str(o.get("route", "")).startswith("/v1/projects")]
win_web = [o for o in rows["web"] if o.get("event") == "api.request" and lo <= o["time"] <= hi]
if len(win_api) != len(win_web) or not win_api: why.append(f"journey window: API completions {len(win_api)} vs web api.request {len(win_web)}")
ids = collections.Counter(o["requestId"] for o in win_api)
create_responses = [p for p in journey.get("createPosts", []) if urlparse(str(p.get("url", ""))).path.rstrip("/") == "/projects"]
cid = create_responses[0].get("xRequestId") if len(create_responses) == 1 else None
web_c = [o for o in rows["web"] if o.get("requestId") == cid and o.get("event") == "api.request" and o.get("operation") == "projects.create"]
api_c = [o for o in rows["api"] if o.get("requestId") == cid and o.get("event") == "request.complete" and o.get("method") == "POST" and o.get("route") == "/v1/projects"]
if len(create_responses) != 1: why.append(f"create journey has {len(create_responses)} POST /projects responses; expected exactly 1")
elif not cid or len(web_c) != 1 or len(api_c) != 1: why.append(f"create not traceable by request id {cid}: web create records {len(web_c)}, API create completions {len(api_c)}")
res = {"ok": not why, "why": why[:10], "lines": total, "non_json": bad_lines, "window_api_completions": len(win_api), "window_web_api_requests": len(win_web), "create_response_matches": len(create_responses), "create_request_id": cid, "create_web_records": len(web_c), "create_api_completions": len(api_c), "shared_ids_in_window": sum(1 for v in ids.values() if v > 1)}
json.dump(res, open(outf, "w"), indent=2); print(json.dumps(res)); sys.exit(0 if res["ok"] else 1)
