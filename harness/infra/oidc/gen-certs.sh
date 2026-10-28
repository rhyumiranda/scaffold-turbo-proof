#!/bin/bash
# usage: gen-certs.sh DIR   Throwaway CA + leaf for app.acme.test / id.acme.test (openssl; replaces mkcert, same trust shape).
# Prints the leaf SPKI pin (base64 sha256) used by Chromium's --ignore-certificate-errors-spki-list.
set -e
d="$1"; mkdir -p "$d"; cd "$d"
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 2 -subj "/CN=acc-harness-ca" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout site.key -out site.csr -subj "/CN=app.acme.test" 2>/dev/null
printf 'subjectAltName=DNS:app.acme.test,DNS:id.acme.test\nbasicConstraints=CA:FALSE\n' > ext.cnf
openssl x509 -req -in site.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out site.crt -days 2 -extfile ext.cnf 2>/dev/null
chmod 644 ca.crt site.crt site.key
openssl x509 -in site.crt -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64 > spki.txt
