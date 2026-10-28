import sys, json, re, socket
# usage: ac53_analyze.py <timeline.jsonl> <events.txt>   events: "name epoch" lines
tl = [json.loads(l) for l in open(sys.argv[1])]
ev = {l.split()[0]: float(l.split()[1]) for l in open(sys.argv[2]) if l.strip()}
live = [r for r in tl if r["url"] == "live"]; ready = sorted([r for r in tl if r["url"] == "ready"], key=lambda r: r["epoch"])
why = []
if not live or any(r["status"] != 200 for r in live): why.append("liveness not 200 throughout: %s" % sorted({str(r["status"]) for r in live}))
first503 = next((r for r in ready if r["epoch"] >= ev["stop_begin"] and r["status"] == 503), None)
if not first503 or first503["epoch"] - ev["stop_begin"] > 5: why.append("no 503 within 5 s of DB loss")
late = [r for r in ready if ev["stop_begin"] + 5 <= r["epoch"] < ev["pg_accepting"] - 0.6 and r["status"] != 503]
if late: why.append("%d ready responses were not 503 in the outage window" % len(late))
back = next((r for r in ready if r["epoch"] >= ev["pg_accepting"] and r["status"] == 200), None)
if not back or back["epoch"] - ev["pg_accepting"] > 10: why.append("ready not 200 within 10 s of DB recovery")
host = socket.gethostname()
for r in tl:
    b = r["body"]
    if re.search(r"\b\d+\.\d+\.\d+\b", b) or host in b or "localhost" in b or re.search(r"Error|Exception|ECONN|ENOTFOUND|stack|node_modules|\.js:\d+", b):
        why.append("body leaks version/host/error text: " + b[:80]); break
print(json.dumps({"ok": not why, "why": why, "first503_after_stop_s": first503 and round(first503["epoch"] - ev["stop_begin"], 2), "ready_200_after_recovery_s": back and round(back["epoch"] - ev["pg_accepting"], 2), "samples": len(tl)}))
sys.exit(1 if why else 0)
