#!/usr/bin/env bash
set -euo pipefail

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is required to generate a locally-trusted certificate."
  echo "Install it from https://github.com/FiloSottile/mkcert and retry."
  exit 1
fi

mkdir -p certs

mkcert -install
mkcert \
  -key-file certs/localhost-key.pem \
  -cert-file certs/localhost.pem \
  127.0.0.1 localhost ::1

echo "Generated certs in certs/"
