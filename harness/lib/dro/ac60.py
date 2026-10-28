import socket, sys, json, time
# usage: ac60.py <api_port> <web_port>   Raw requests with hostile correlation headers; prints what the server returned.
def raw(port, path, headers, label):
    s = socket.create_connection(("127.0.0.1", port)); s.settimeout(10)
    req = f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n".encode() + b"".join(k.encode() + b": " + v + b"\r\n" for k, v in headers) + b"\r\n"
    s.sendall(req); data = b""
    try:
        while True:
            c = s.recv(65536)
            if not c: break
            data += c
    except Exception: pass
    head = data.split(b"\r\n\r\n")[0].decode("latin1").split("\r\n")
    got = {l.split(":", 1)[0].lower(): l.split(":", 1)[1].strip() for l in head[1:] if ":" in l}
    print(json.dumps({"label": label, "port": port, "path": path, "status": head[0], "x-request-id": got.get("x-request-id"), "x-trace-id": got.get("x-trace-id")}))
forged = b'abc\r\n{"level":"error","event":"forged","service":"api"}'
cases = [
  ("crlf-raw", [("x-request-id", forged)]),
  ("crlf-percent-encoded", [("x-request-id", b"abc%0D%0A%7B%22level%22%3A%22error%22%2C%22event%22%3A%22forged%22%7D")]),
  ("json-breaking-quotes", [("x-request-id", b'abc","event":"forged","level":"error')]),
  ("lf-only-raw", [("x-request-id", b'abc\n{"level":"error","event":"forged"}')]),
  ("10KB", [("x-request-id", b"A" * 10240)]),
  ("invalid-traceparent", [("traceparent", b"00-zzzz-not-a-trace-01")]),
  ("traceparent-allzero", [("traceparent", b"00-00000000000000000000000000000000-0000000000000000-01")]),
  ("huge-traceparent", [("traceparent", b"00-" + b"a" * 10000 + b"-1234567890123456-01")]),
  ("valid-uuid", [("x-request-id", b"12345678-1234-4234-8234-123456789012"), ("traceparent", b"00-12345678901234567890123456789012-1234567890123456-01")]),
]
api, web = int(sys.argv[1]), int(sys.argv[2])
for port, path in ((api, "/health/live"), (api, "/v1/projects"), (web, "/healthz"), (web, "/projects")):
    for label, h in cases:
        raw(port, path, h, label); time.sleep(0.05)
