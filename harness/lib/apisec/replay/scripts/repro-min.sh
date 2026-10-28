#!/bin/bash
# Minimal 500 reproductions, no session cookie, no login. usage: repro-min.sh CREATE_ID RENAME_ID
C=$1; R=$2; B=----z2b; U=http://localhost:3103/projects
H=(-H "Origin: http://localhost:3103" -H "Sec-Fetch-Site: same-origin")
t() { # label, extra headers..., body-file
  local label=$1; shift; local body=$1; shift
  code=$(curl -s -o $PZ/run/z5.out -w '%{http_code}' -X POST "${H[@]}" "$@" --data-binary @"$body" $U)
  printf '%-58s HTTP %s  %s\n' "$label" "$code" "$(head -c 70 $PZ/run/z5.out | tr '\r\n' '  ')"
}
D=$(mktemp -d); mp() { printf -- "--$B\r\n%b\r\n--$B--\r\n" "$1"; }
CT=(-H "Content-Type: multipart/form-data; boundary=$B")
NA=(-H "Next-Action: $C")
# 0: control (valid browser-shaped request)
mp 'Content-Disposition: form-data; name="0"\r\n\r\n[{"status":"idle"},"$K1"]\r\n--'$B'\r\nContent-Disposition: form-data; name="1_name"\r\n\r\nrepro-control' > $D/a; t "A0 control: valid scripted post" $D/a "${CT[@]}" "${NA[@]}"
# A: parser differences between the proxy (undici formData) and the framework (busboy)
mp 'Content-Disposition: form-data; name="0"\r\nContent-Transfer-Encoding: base64\r\n\r\nWyIkSzEiXQ==' > $D/b; t "A1 base64 part decoded by proxy, raw in framework" $D/b "${CT[@]}" "${NA[@]}"
mp 'Content-Disposition: form-data; name="0"\r\nContent-Type: text/plain; charset=utf-16le\r\n\r\n["$K1"]' > $D/c; t "A2 part charset=utf-16le" $D/c "${CT[@]}" "${NA[@]}"
mp "Content-Disposition: form-data; name*=utf-8''0\r\n\r\n[\"\$K1\"]" > $D/d; t "A3 name*=utf-8''0" $D/d "${CT[@]}" "${NA[@]}"
mp 'Content-Disposition: form-data; name="x"; name="0"\r\n\r\n["$K1"]' > $D/e; t "A4 duplicated name parameter" $D/e "${CT[@]}" "${NA[@]}"
python3 -c "
import sys
B='$B'
sys.stdout.write('--%s\r\nContent-Disposition: form-data; name=\"0\"\r\nX-Pad: %s\r\n\r\n[\"\$K1\"]\r\n--%s--\r\n'%(B,'a'*200000,B))" > $D/f; t "A5 200 KB extra part header" $D/f "${CT[@]}" "${NA[@]}"
python3 -c "
import sys
B='$B'
sys.stdout.write('--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\nx\r\n--%s\r\nContent-Disposition: form-data; name=\"0\"\r\n\r\n[\"\$K1\"]\r\n--%s--\r\n'%(B,'n'*100000,B,B))" > $D/g; t "A6 100 KB field name" $D/g "${CT[@]}" "${NA[@]}"
# B: argument list longer than the framework's limit (1000)
python3 -c "
import sys
B='$B'
sys.stdout.write('--%s\r\nContent-Disposition: form-data; name=\"0\"\r\n\r\n[%s0]\r\n--%s--\r\n'%(B,'0,'*1000,B))" > $D/h; t "B1 top-level array of 1001 numbers" $D/h "${CT[@]}" "${NA[@]}"
python3 -c "
import sys
B='$B'
sys.stdout.write('--%s\r\nContent-Disposition: form-data; name=\"0\"\r\n\r\n[%s0]\r\n--%s--\r\n'%(B,'0,'*999,B))" > $D/i; t "B2 top-level array of 1000 numbers (boundary)" $D/i "${CT[@]}" "${NA[@]}"
# C: script-free form posts whose bound-argument references point at nothing
mp 'Content-Disposition: form-data; name="$ACTION_REF_1"\r\n\r\n\r\n--'$B'\r\nContent-Disposition: form-data; name="$ACTION_1:0"\r\n\r\n{"id":"'$C'","bound":"$@2"}' > $D/j; t "C1 bound \$@2 (no \$ACTION_1:2 field)" $D/j "${CT[@]}"
mp 'Content-Disposition: form-data; name="$ACTION_REF_1"\r\n\r\n\r\n--'$B'\r\nContent-Disposition: form-data; name="$ACTION_1:0"\r\n\r\n{"id":"'$C'","bound":"$@1"}\r\n--'$B'\r\nContent-Disposition: form-data; name="$ACTION_1:1"\r\n\r\nnull' > $D/k; t "C2 bound \$@1 with \$ACTION_1:1 = null" $D/k "${CT[@]}"
mp 'Content-Disposition: form-data; name="$ACTION_REF_1"\r\n\r\n\r\n--'$B'\r\nContent-Disposition: form-data; name="$ACTION_1:0"\r\n\r\n{"id":"'$C'","bound":"$@1"}' > $D/l; t "C3 bound \$@1 and no \$ACTION_1:1 field" $D/l "${CT[@]}"
# D: methods
code=$(curl -s -o $PZ/run/z5.out -w '%{http_code}' -X TRACE "${H[@]}" $U); printf '%-58s HTTP %s  %s\n' "D1 TRACE /projects (no body, no cookie)" "$code" "$(head -c 60 $PZ/run/z5.out)"
code=$(curl -s -o $PZ/run/z5.out -w '%{http_code}' -X TRACE "${H[@]}" http://localhost:3103/nope); printf '%-58s HTTP %s  %s\n' "D2 TRACE /nope" "$code" "$(head -c 60 $PZ/run/z5.out)"
code=$(curl -s -o $PZ/run/z5.out -w '%{http_code}' -X TRACE http://localhost:3103/); printf '%-58s HTTP %s  %s\n' "D3 TRACE / (no origin headers)" "$code" "$(head -c 60 $PZ/run/z5.out)"
rm -rf $D
