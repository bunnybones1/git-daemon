#!/usr/bin/env bash
set -euo pipefail

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is required to generate a locally-trusted certificate."
  echo "Install it from https://github.com/FiloSottile/mkcert and retry."
  exit 1
fi

CONFIG_DIR=$(node -e "const mod=require('env-paths'); const envPaths=mod.default||mod; console.log(envPaths('Git Daemon',{suffix:''}).config)")
CERT_DIR="${CONFIG_DIR}/certs"

mkdir -p "${CERT_DIR}"

mkcert -install
mkcert \
  -key-file "${CERT_DIR}/localhost-key.pem" \
  -cert-file "${CERT_DIR}/localhost.pem" \
  127.0.0.1 localhost ::1

echo "Generated certs in ${CERT_DIR}"
