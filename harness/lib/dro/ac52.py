import sys, json, os, urllib.request, urllib.error, concurrent.futures as cf
# usage: ac52.py create|page <outdir>   env: TOKEN API_URL
mode, out = sys.argv[1], sys.argv[2]
api, tok = os.environ["API_URL"], os.environ["TOKEN"]
def call(method, path, body=None):
    req = urllib.request.Request(api + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"authorization": "Bearer " + tok, "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e: return e.code, (json.loads(e.read() or b"null") if e.headers.get("content-type", "").startswith("application/") else None)
if mode == "create":
    def make(i): return call("POST", "/v1/projects", {"name": f"AC52 project {i:03d}"})
    with cf.ThreadPoolExecutor(8) as ex: results = list(ex.map(make, range(120)))
    statuses = [s for s, _ in results]
    open(f"{out}/create-statuses.txt", "w").write("\n".join(map(str, statuses)) + "\n")
    open(f"{out}/created-ids.txt", "w").write("\n".join(b["id"] for s, b in results if s == 201) + "\n")
    print("created", statuses.count(201), "of 120")
else:
    ids, offset = [], 0
    while True:
        s, rows = call("GET", f"/v1/projects?limit=100&offset={offset}")
        assert s == 200, f"page request failed: {s}"
        ids += [r["id"] for r in rows]
        if len(rows) < 100: break
        offset += 100
    open(f"{out}/api-order.txt", "w").write("\n".join(ids) + "\n")
    probes = {}
    for q in ("limit=101", "limit=1000", "limit=0", "limit=-1", "limit=abc"):
        s, body = call("GET", f"/v1/projects?{q}")
        probes[q] = {"status": s, "items": len(body) if isinstance(body, list) else None}
    json.dump(probes, open(f"{out}/limit-probes.json", "w"), indent=2)
    print("paged", len(ids), json.dumps(probes))
