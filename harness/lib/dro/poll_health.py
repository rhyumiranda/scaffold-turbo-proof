import sys, time, urllib.request, urllib.error, json, threading
# usage: poll_health.py <out.jsonl> <seconds> <url>...   every 500 ms, no auth
out, dur, urls = sys.argv[1], float(sys.argv[2]), sys.argv[3:]
f = open(out, "w"); lock = threading.Lock(); t0 = time.time()
def hit(u):
    s = time.time()
    try:
        r = urllib.request.urlopen(u, timeout=8); code, body = r.status, r.read().decode()
    except urllib.error.HTTPError as e: code, body = e.code, e.read().decode()
    except Exception as e: code, body = "ERR", type(e).__name__
    with lock: f.write(json.dumps({"epoch": round(s, 3), "url": u.rsplit("/", 1)[-1], "status": code, "ms": int((time.time() - s) * 1000), "body": body[:400]}) + "\n"); f.flush()
while time.time() - t0 < dur:
    for u in urls: threading.Thread(target=hit, args=(u,)).start()
    time.sleep(0.5)
time.sleep(9); f.close()
