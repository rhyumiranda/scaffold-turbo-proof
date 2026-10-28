#!/bin/bash
# z5 minimal 500 reproductions against the production web on :3103. curl only, NO cookie, NO login. usage: repro-j.sh CREATE_ID
C=$1; U=http://localhost:3103/projects
H=(-H "Origin: http://localhost:3103" -H "Sec-Fetch-Site: same-origin" -H "Next-Action: $C")
t() { local label=$1 ct=$2 file=$3
  code=$(curl -s -o $PZ/run/z5.out -w '%{http_code}' -X POST "${H[@]}" -H "Content-Type: $ct" --data-binary @"$file" $U)
  printf '%-62s HTTP %s  %s\n' "$label" "$code" "$(head -c 60 $PZ/run/z5.out | tr '\r\n' '  ')"; }
D=$(mktemp -d)
# control: exactly what a browser sends
printf -- '--B\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--B\r\nContent-Disposition: form-data; name="_1_name"\r\n\r\nx\r\n--B--\r\n' > $D/ok; t "J0 control, boundary=B" "multipart/form-data; boundary=B" $D/ok
# J1: unquoted boundary containing a character that is not an HTTP token char: the proxy accepts it, busboy throws "Malformed content type"
for b in 'a/b' 'a=b' 'a:b' 'a(b)' 'a,b' 'a?b'; do
  printf -- "--$b\r\nContent-Disposition: form-data; name=\"0\"\r\n\r\n[\"\$K1\"]\r\n--$b\r\nContent-Disposition: form-data; name=\"_1_name\"\r\n\r\nx\r\n--$b--\r\n" > $D/j1; t "J1 unquoted boundary=$b" "multipart/form-data; boundary=$b" $D/j1
  t "J1q quoted   boundary=\"$b\" (same body)" "multipart/form-data; boundary=\"$b\"" $D/j1
done
# J2: a field value containing CRLF + "--B--" ends the body for busboy, but the proxy (lastIndexOf) still sees a later field 0
printf -- '--B\r\nContent-Disposition: form-data; name="_1_name"\r\n\r\nx\r\n--B--\r\nIGNORED\r\n--B\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--B--\r\n' > $D/j2; t "J2 value holds CRLF--B--, real field 0 after it" "multipart/form-data; boundary=B" $D/j2
# J3: CRLF + "--B" + CR (no LF) inside a value
printf -- '--B\r\nContent-Disposition: form-data; name="_1_name"\r\n\r\nx\r\n--B\r\r\n--B\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--B--\r\n' > $D/j3; t "J3 value holds CRLF--B then CR" "multipart/form-data; boundary=B" $D/j3
rm -rf $D
# J4: a value that starts with "--B" right after the part-header blank line (busboy reuses the header's CRLF as the delimiter)
D2=$(mktemp -d)
printf -- '--B\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--B\r\nContent-Disposition: form-data; name="_2_f1"\r\n\r\n--B\r\n--B--\r\n' > $D2/j4; t "J4 value starts with --B" "multipart/form-data; boundary=B" $D2/j4
# J5: Host / X-Forwarded-Host that differs from Origin: the proxy accepts (Origin == configured origin), the framework answers 500 "Invalid Server Actions request"
printf -- '--B\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--B\r\nContent-Disposition: form-data; name="_1_name"\r\n\r\nx\r\n--B--\r\n' > $D2/ok
for hh in 'Host: evil.example' 'X-Forwarded-Host: evil.example' 'Host: 127.0.0.1:3103' 'Host: [::1]:3103'; do
  code=$(curl -s -o $PZ/run/z5.out -w '%{http_code}' -X POST "${H[@]}" -H "Content-Type: multipart/form-data; boundary=B" -H "$hh" --data-binary @$D2/ok $U)
  printf '%-62s HTTP %s  %s\n' "J5 valid browser body + $hh" "$code" "$(head -c 40 $PZ/run/z5.out | tr '\r\n' '  ')"; done
# J6: request-target "*"
for m in GET HEAD OPTIONS POST; do code=$(curl -s -o /dev/null -w '%{http_code}' --request-target '*' -X $m http://localhost:3103); printf '%-62s HTTP %s\n' "J6 $m * HTTP/1.1" "$code"; done
# J7: image optimizer fed a local page that redirects
for u in '%2F' '%2Fprojects'; do code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3103/_next/image?url=$u&w=64&q=75"); printf '%-62s HTTP %s\n' "J7 GET /_next/image?url=$u" "$code"; done
rm -rf $D2
