import sys, json, re, collections
# usage: ac62_check.py <operations.md> <otel.jsonl> <out.json> <log files...>
doc, otel, outf, *logs = sys.argv[1:]
text = open(doc).read(); why = []
m = re.search(r"## Service-level indicators(.*?)(?=\n## )", text, re.S)
sec = m.group(1) if m else ""
if not sec: why.append("no Service-level indicators section")
if "placeholder" not in sec.lower(): why.append("targets are not marked as placeholders")
rows = [r for r in sec.splitlines() if r.startswith("|") and not r.startswith("|---") and not r.startswith("| Indicator")]
names = [r.split("|")[1].strip().lower() for r in rows]
for want in ("availability", "latency", "error"):
    if not any(want in n for n in names): why.append(f"no {want} indicator")
metrics, attrkeys = set(), set()
for l in open(otel, errors="replace"):
    if not l.strip(): continue
    o = json.loads(l)
    for rm in o.get("resourceMetrics", []):
        for sm in rm.get("scopeMetrics", []):
            for mt in sm.get("metrics", []):
                metrics.add(mt["name"])
                for k in ("histogram", "sum", "gauge"):
                    for dp in mt.get(k, {}).get("dataPoints", []):
                        attrkeys |= {a["key"] for a in dp.get("attributes", [])}
events, fields = set(), set()
for f in logs:
    for l in open(f, errors="replace"):
        try: o = json.loads(l)
        except Exception: continue
        if isinstance(o, dict): events.add(o.get("event")); fields |= set(o)
found = {}
for r, n in zip(rows, names):
    toks = []
    for span in re.findall(r"`([^`]+)`", r): toks.append(span.split(":")[0].strip())
    toks = [t for t in toks if re.fullmatch(r"[A-Za-z][\w.]*", t)]
    missing = [t for t in toks if t not in metrics and t not in events and t not in fields and t not in attrkeys]
    found[n] = {"signals": toks, "missing": missing}
    if not toks: why.append(f"{n}: names no signal")
    if missing: why.append(f"{n}: not emitted: {missing}")
res = {"ok": not why, "why": why, "indicators": found}
json.dump(res, open(outf, "w"), indent=2); print(json.dumps(res)); sys.exit(0 if res["ok"] else 1)
