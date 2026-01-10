#!/usr/bin/env bash
set -euo pipefail

if [[ "${MKCERT_AUTO_TRUST:-1}" != "0" ]] && command -v mkcert >/dev/null 2>&1; then
  CAROOT=$(mkcert -CAROOT)
  export NODE_EXTRA_CA_CERTS="${CAROOT}/rootCA.pem"
fi

mkdir -p .tmp
TMPDIR="$PWD/.tmp" exec tsx src/cli-test-clone.ts
