import socket, sys, time
# usage: hold_upload.py <port> <seconds>   env TOKEN. Sends complete headers declaring a body, then trickles 1 byte/s (in-flight upload).
port, secs = int(sys.argv[1]), float(sys.argv[2])
import os
s = socket.create_connection(("127.0.0.1", port))
s.sendall(f"POST /v1/projects HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {os.environ['TOKEN']}\r\nContent-Type: application/json\r\nContent-Length: 100000\r\n\r\n".encode())
t0 = time.time()
try:
    while time.time() - t0 < secs:
        s.sendall(b"a"); time.sleep(1)
except OSError: pass
print("upload connection ended after %.2fs" % (time.time() - t0))
