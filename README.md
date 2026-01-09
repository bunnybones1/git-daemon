# Git Daemon

Git Daemon is a local Node.js service that exposes a small, authenticated HTTP API for a trusted web UI to perform Git and developer convenience actions on your machine. It is designed to run on `127.0.0.1` only, enforce a strict Origin allowlist, and sandbox all filesystem access to a configured workspace root.

## What it does

- Clone, fetch, and read Git status using your system Git credentials
- Stream long-running job logs via Server-Sent Events (SSE)
- Open a repo in the OS file browser, terminal, or VS Code (with approvals)
- Install dependencies with safer defaults (`--ignore-scripts` by default)

## Security model (high level)

- **Loopback-only**: binds to `127.0.0.1`
- **Origin allowlist**: every request must include a matching `Origin`
- **DNS rebinding protections**: verifies `Host` and remote loopback address
- **Pairing token**: required for all non-public endpoints
- **Workspace sandbox**: all paths must resolve inside the configured root
- **Capability approvals**: required for open-terminal/open-vscode/deps install

## Requirements

- Node.js (for running the daemon)
- Git (for clone/fetch/status)
- Optional: `code` CLI for VS Code, `pnpm`/`yarn` for dependency installs

## Install

```bash
npm install
```

## Run the daemon

```bash
npm run daemon
```

The daemon listens on `http://127.0.0.1:8787` by default.

## Pairing flow

Pairing is required before using protected endpoints.

1. Start pairing:

```bash
curl -H "Origin: https://app.example.com" \
  -H "Content-Type: application/json" \
  -d '{"step":"start"}' \
  http://127.0.0.1:8787/v1/pair
```

2. Confirm pairing with the code:

```bash
curl -H "Origin: https://app.example.com" \
  -H "Content-Type: application/json" \
  -d '{"step":"confirm","code":"<CODE>"}' \
  http://127.0.0.1:8787/v1/pair
```

The response includes `accessToken` to use as `Authorization: Bearer <token>`.

## Example usage

Check meta:

```bash
curl -H "Origin: https://app.example.com" \
  http://127.0.0.1:8787/v1/meta
```

Clone a repo (job):

```bash
curl -X POST \
  -H "Origin: https://app.example.com" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"git@github.com:owner/repo.git","destRelative":"owner/repo"}' \
  http://127.0.0.1:8787/v1/git/clone
```

Stream job logs (SSE):

```bash
curl -N \
  -H "Origin: https://app.example.com" \
  -H "Authorization: Bearer <TOKEN>" \
  http://127.0.0.1:8787/v1/jobs/<JOB_ID>/stream
```

## Configuration

Config is stored in OS-specific directories:

- macOS: `~/Library/Application Support/Git Daemon`
- Linux: `~/.config/git-daemon`
- Windows: `%APPDATA%\\Git Daemon`

You can override the config directory with:

```bash
GIT_DAEMON_CONFIG_DIR=/path/to/config npm run daemon
```

Key settings live in `config.json`:

- `originAllowlist`: array of allowed UI origins
- `workspaceRoot`: absolute path to the workspace root
- `deps.defaultSafer`: defaults to `true` for `--ignore-scripts`
- `jobs.maxConcurrent` and `jobs.timeoutSeconds`

Tokens are stored (hashed) in `tokens.json`. Logs are written under the configured `logging.directory` with rotation.

## Development

Run tests:

```bash
npm test
```

Lint:

```bash
npm run lint
```

## API reference

See `openapi.yaml` for the full contract.
