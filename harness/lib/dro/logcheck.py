import sys, json, collections
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
cid = journey["createPosts"][0]["xRequestId"] if journey.get("createPosts") else None
web_c = [o for o in rows["web"] if o.get("requestId") == cid]; api_c = [o for o in rows["api"] if o.get("requestId") == cid and o.get("event") == "request.complete"]
if not cid or not web_c or not api_c or not any(o.get("method") == "POST" for o in api_c): why.append(f"create not traceable by request id {cid}: web records {len(web_c)}, API completions {len(api_c)}")
res = {"ok": not why, "why": why[:10], "lines": total, "non_json": bad_lines, "window_api_completions": len(win_api), "window_web_api_requests": len(win_web), "create_request_id": cid, "create_web_records": len(web_c), "create_api_completions": len(api_c), "shared_ids_in_window": sum(1 for v in ids.values() if v > 1)}
json.dump(res, open(outf, "w"), indent=2); print(json.dumps(res)); sys.exit(0 if res["ok"] else 1)
