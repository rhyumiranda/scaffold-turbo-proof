import sys, json, re
# usage: ac60_check.py <requests.jsonl> <out.json> <log files...>
reqs = [json.loads(l) for l in open(sys.argv[1]) if l.startswith("{")]; why = []; lines = 0
uuid = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
for f in sys.argv[3:]:
    for line in open(f, errors="replace"):
        if not line.strip(): continue
        lines += 1
        try: o = json.loads(line)
        except Exception: why.append(f"unparseable log line in {f}: {line[:60]!r}"); continue
        if o.get("event") == "forged" or o.get("service") == "forged": why.append("forged line reached the log")
        for k in ("requestId", "traceId"):
            if isinstance(o.get(k), str) and len(o[k]) > 128: why.append(f"{k} longer than 128 in log")
for r in reqs:
    rid = r.get("x-request-id")
    if rid is not None and (len(rid) > 128 or not uuid.match(rid)): why.append(f"{r['label']} {r['port']}{r['path']}: returned id not a replaced uuid: {rid[:40]!r}")
res = {"ok": not why, "why": why[:10], "requests": len(reqs), "log_lines": lines}
json.dump(res, open(sys.argv[2], "w"), indent=2); print(json.dumps(res)); sys.exit(0 if res["ok"] else 1)
