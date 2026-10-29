import sys, json, re
# usage: ac51_check.py <dir> <pool_max> <deadline_s> <slack_s>
d, pool, deadline, slack = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
res = {"ok": True, "why": []}
def bad(m): res["ok"] = False; res["why"].append(m)
samples = []
for line in open(f"{d}/pg-connections-load.txt"):
    p = line.split()
    if len(p) == 3 and p[1].isdigit(): samples.append((float(p[0]), int(p[1]), int(p[2])))
try:
    start, end = map(float, open(f"{d}/load-window.txt").read().split())
    overlap = [s for s in samples if start <= s[0] <= end]
except Exception as e:
    overlap = []
    bad(f"load window unreadable: {e}")
res["load_samples"] = len(samples)
res["load_overlap_samples"] = len(overlap)
res["load_max_all"] = max((s[1] for s in overlap), default=None)
res["load_max_api"] = max((s[2] for s in overlap), default=None)
if len(overlap) < 50: bad(f"only {len(overlap)} connection samples overlap the load run (need >= 50)")
if overlap and res["load_max_all"] > pool: bad(f"connections to the database reached {res['load_max_all']} (pool max {pool})")
try:
    k6 = json.load(open(f"{d}/k6/summary.json"))["metrics"]
    res["k6"] = {k: k6[k].get("count", k6[k].get("value")) for k in k6 if k.startswith("status_") or k == "http_reqs"}
    if (k6.get("http_reqs", {}).get("count") or 0) < 1000: bad("k6 sent fewer than 1000 requests")
except Exception as e:
    bad(f"k6 summary unreadable: {e}")
rows = []
for line in open(f"{d}/latency/latency-50.txt"):
    p = line.split()
    if len(p) == 3: rows.append((int(p[0]), p[1], float(p[2])))
res["latency_requests"] = len(rows)
if len(rows) != 50: bad(f"{len(rows)} of 50 latency requests recorded")
codes = {}
for _, c, _ in rows: codes[c] = codes.get(c, 0) + 1
res["latency_status_histogram"] = codes
res["latency_max_seconds"] = max((r[2] for r in rows), default=None)
if any(c not in ("503", "504") for _, c, _ in rows): bad(f"statuses under DB latency were {codes}, expected only 503/504")
if rows and res["latency_max_seconds"] > deadline + slack: bad(f"slowest request {res['latency_max_seconds']}s exceeds the {deadline}s request deadline (literal bound, slack {slack}s)")
lat_samples = []
try:
    for line in open(f"{d}/pg-connections-latency.txt"):
        p = line.split()
        if len(p) == 3 and p[1].isdigit(): lat_samples.append(int(p[1]))
    res["latency_max_connections"] = max(lat_samples, default=None)
    if lat_samples and max(lat_samples) > pool: bad(f"connections reached {max(lat_samples)} during DB latency (pool max {pool})")
except FileNotFoundError:
    pass
print(json.dumps(res, indent=2))
sys.exit(0 if res["ok"] else 1)
