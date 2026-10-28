import sys, json, collections, os
# usage: otelcheck.py <otel.jsonl> <web.stdout> <journey.json> <out.json>
otel, webf, jf, outf = sys.argv[1:5]
journey = json.load(open(jf)); why = []
def attrs(a): return {x["key"]: list(x["value"].values())[0] if x.get("value") else None for x in a or []}
spans, metrics = [], collections.defaultdict(set)
raw = open(otel, errors="replace").read()
for l in raw.splitlines():
    if not l.strip(): continue
    o = json.loads(l)
    for rs in o.get("resourceSpans", []):
        svc = attrs(rs["resource"].get("attributes")).get("service.name")
        for ss in rs.get("scopeSpans", []):
            for s in ss.get("spans", []): spans.append(dict(svc=svc, name=s["name"], trace=s["traceId"], id=s["spanId"], parent=s.get("parentSpanId", ""), attrs=attrs(s.get("attributes"))))
    for rm in o.get("resourceMetrics", []):
        svc = attrs(rm["resource"].get("attributes")).get("service.name")
        for sm in rm.get("scopeMetrics", []):
            for m in sm.get("metrics", []): metrics[m["name"]].add(next((k for k in ("histogram", "sum", "gauge", "exponentialHistogram") if k in m), "?"))
web = [json.loads(l) for l in open(webf) if l.startswith("{")]
create = [o for o in web if o.get("event") == "api.request" and o.get("operation") == "projects.create"]
tid = create[0].get("traceId") if create else None
chain = [s for s in spans if s["trace"] == tid]; byid = {s["id"]: s for s in chain}
services = sorted({s["svc"] for s in chain if s["svc"]})
paths = []
for q in [s for s in chain if s["name"] == "postgres.query"]:
    p, cur = [], q
    while cur: p.append(f"{cur['svc']}:{cur['name']}"); cur = byid.get(cur["parent"])
    paths.append(p)
good = [p for p in paths if len(p) >= 3 and p[1].endswith(":http.request") and p[0].split(":")[0] == p[1].split(":")[0] and any(x.split(":")[0] != p[0].split(":")[0] for x in p[2:])]
if not tid: why.append("no web create log record with a trace id")
if len(services) < 2: why.append(f"trace {tid} has spans from {services}")
if not good: why.append(f"no postgres.query <- API http.request <- web span chain; paths {paths}")
if "histogram" not in metrics.get("http.server.duration", set()): why.append("no http.server.duration histogram")
pool = [m for m in metrics if m.startswith("db.pool.")]
if not pool: why.append("no db.pool.* metric")
name = journey.get("projectName", "")
if name and name in raw: why.append("project name (SQL parameter value) found in exported telemetry")
res = {"ok": not why, "why": why, "trace_id": tid, "services": services, "paths": good[:2], "metrics": {k: sorted(v) for k, v in metrics.items()}, "span_count": len(spans)}
json.dump(res, open(outf, "w"), indent=2); print(json.dumps(res)); sys.exit(0 if res["ok"] else 1)
