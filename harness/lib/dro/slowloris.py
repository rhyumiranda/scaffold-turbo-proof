import socket, sys, time, threading, json, re
# usage: slowloris.py <out.json> host:port:mode:limit_s ...   mode headers|body. Reports server-side close time.
res = []
def run(host, port, mode, cap):
    s = socket.create_connection((host, port)); t0 = time.time(); closed = {}
    def reader():
        try:
            while True:
                if not s.recv(4096): break
        except OSError: pass
        closed["t"] = time.time() - t0
    th = threading.Thread(target=reader, daemon=True); th.start()
    try:
        if mode == "headers": s.sendall(f"GET /x HTTP/1.1\r\nHost: {host}:{port}\r\nX-Slow: ".encode())
        else: s.sendall(f"POST /x HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\nContent-Length: 100000\r\n\r\n".encode())
        while "t" not in closed and time.time() - t0 < cap:
            time.sleep(1)
            try: s.sendall(b"a")
            except OSError: break
    except OSError: pass
    th.join(2)
    res.append({"target": f"{host}:{port}", "mode": mode, "closed_after_s": round(closed["t"], 3) if "t" in closed else None, "cap_s": cap})
ts = []
for a in sys.argv[2:]:
    h, p, m, c = a.split(":"); t = threading.Thread(target=run, args=(h, int(p), m, float(c))); t.start(); ts.append(t)
for t in ts: t.join()
json.dump(res, open(sys.argv[1], "w"), indent=2); print(json.dumps(res))
