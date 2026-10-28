import sys, os, json
# usage: leakgrep.py <needles.json> <out.json> <file>...   env names listed in NEEDLE_ENV are added as needles. Values are never printed.
needles = json.load(open(sys.argv[1]))
for n in os.environ.get("NEEDLE_ENV", "").split():
    if os.environ.get(n): needles["env:" + n] = os.environ[n]
files = sys.argv[3:]; report = []; total = 0
for f in files:
    c = open(f, errors="replace").read()
    hits = sorted(k for k, v in needles.items() if v and v in c)
    total += len(hits); report.append({"file": f.split("evidence/")[-1], "bytes": len(c), "hits": hits})
res = {"needles_checked": sorted(needles), "files": report, "total_hits": total, "ok": total == 0 and len(files) > 0}
json.dump(res, open(sys.argv[2], "w"), indent=2); print(json.dumps({"total_hits": total, "files": len(files), "needles": len(needles)})); sys.exit(0 if res["ok"] else 1)
