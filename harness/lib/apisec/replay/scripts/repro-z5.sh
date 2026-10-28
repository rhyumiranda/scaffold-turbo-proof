#!/bin/bash
# z5 minimal 500 reproductions against the production web on :3103. curl only, NO cookie, NO login.
U=http://localhost:3103
t() { code=$(curl -s -o "$PZ/run/o.txt" -w '%{http_code}' --path-as-is "$@"); printf '%-72s HTTP %s  %s\n' "$LABEL" "$code" "$(head -c 50 "$PZ/run/o.txt" | tr '\r\n' '  ')"; }
echo "# class P: malformed percent-encoding in a dynamic route segment (/auth/[operation])"
for p in '/auth/%' '/auth/%zz' '/auth/%2' '/auth/%c0%af' '/auth/%ff' '/auth/login%' '/auth/%E0%A4%A'; do LABEL="GET $p"; t "$U$p"; done
LABEL="HEAD /auth/%"; t -I "$U/auth/%"; LABEL="OPTIONS /auth/%"; t -X OPTIONS "$U/auth/%"
echo "# controls: valid encodings"
for p in '/auth/%25' '/auth/%00' '/auth/login' '/auth/x'; do LABEL="GET $p"; t "$U$p"; done
echo "# class G: framework-internal route /_global-error"
LABEL="GET /_global-error"; t "$U/_global-error"; LABEL="HEAD /_global-error"; t -I "$U/_global-error"
echo "# class R: RSC request with a router state tree to a not-found path"
for tree in '%5B%22%22%5D' '%7B%7D' 'x' '%5B%22%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D'; do LABEL="GET /nope RSC:1 State-Tree=$tree"; t -H 'RSC: 1' -H "Next-Router-State-Tree: $tree" "$U/nope"; done
LABEL="control GET /nope RSC:1 (no state tree)"; t -H 'RSC: 1' "$U/nope"
LABEL="control GET /nope (plain)"; t "$U/nope"
LABEL="GET /anything/else RSC:1 State-Tree"; t -H 'RSC: 1' -H 'Next-Router-State-Tree: %5B%22%22%5D' "$U/anything/else"
echo "# class R2: same malformed Next-Router-State-Tree on EXISTING public pages (curl -L follows the framework's own _rsc redirect)"
for p in '/' '/signed-out' '/sign-in-problem'; do for tr in 'x' '%7B%7D'; do LABEL="GET -L $p?_rsc=abc12 RSC:1 State-Tree=$tr"; t -L -H 'RSC: 1' -H "Next-Router-State-Tree: $tr" "$U$p?_rsc=abc12"; done; done
