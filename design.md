# Git Daemon Design Document

## Overview

**Git Daemon** is a local, background service that enables a trusted web UI (React app) to perform **privileged, local machine actions**—primarily Git operations and developer convenience actions—without granting the browser arbitrary system access.

This project includes **only the daemon**. The React UI is external and out of scope; UI references here exist solely to define integration expectations.

The daemon exposes a **localhost HTTP API** guarded by:

* **Origin allowlist** (only your UI URLs)
* **Pairing token** (per-user secret)
* **Workspace sandbox** (all filesystem actions constrained)

---

## Goals

* Enable “Clone locally” from a web UI using native Git credentials (SSH / credential helper).
* Provide additional local dev actions:

  * `fetch`
  * `status`
  * open folder / terminal / VS Code
  * run dependency installation (`npm i` / pnpm / yarn)
* Prevent any website other than the approved UI origins from controlling the daemon.
* Prevent the approved UI from writing outside a user-approved local workspace root.

## Non-goals

* Acting as a GitHub API proxy or storing GitHub OAuth tokens.
* Building or shipping the React UI.
* Acting as a full Git GUI (diff viewer, staging UI, merge tools) — those are UI concerns.
* Running arbitrary shell commands. (Only explicit, whitelisted operations.)

---

## Integration Context (External)

These components are **not part of this project**; they are listed only to define how the daemon is used.

### React UI (external)

* Hosted: `https://app.example.com` (Cloudflare Worker URL or custom domain)
* Local: `http://localhost:<uiPort>`
* Calls:

  * GitHub API directly (optional, UI-side)
  * Git Daemon API on `http://127.0.0.1:<daemonPort>`
* The UI may be hosted remotely or run locally, but **the daemon does not proxy GitHub API calls** and **does not accept GitHub tokens**.

### Cloudflare Worker (external)

* Serves hosted UI assets and routing.
* No GitHub API proxying.
* No local operations.

---

## Architecture

### Components
1. **Git Daemon (local service)**

   * Binds to `127.0.0.1` only
   * Implements a small HTTP JSON API + streaming logs (SSE)
   * Optional HTTPS listener can be enabled alongside HTTP
   * Runs **system git** for native credentials & compatibility
   * Runs **package manager installs** in sandboxed repos
   * Provides OS integrations: open folder/terminal/VS Code

---

## Security Model

### Threats addressed

* Malicious websites attempting to send requests to localhost services.
* DNS rebinding and host header abuse against localhost services.
* Path traversal / writing outside intended directories.
* Unintended execution via `npm install` scripts.
* CSRF-like attacks from untrusted origins.

### Controls

#### 1) Bind to loopback only

* Listen on `127.0.0.1:<daemonPort>` (not `0.0.0.0`)
* HTTPS listener may also bind to loopback when enabled
* Reject requests to non-loopback interfaces.

#### 2) Origin allowlist (hard gate)

For every request:

* Check `Origin` header (and optionally `Referer` for diagnostics).
* Allow only exact matches:

  * `https://app.example.com`
  * `http://localhost:<uiPort>` (optionally allow a small dev port set)

If not allowed: respond `403`.

* Require `Origin` for all requests (reject missing/empty).

#### 2b) DNS rebinding protections

* Verify remote address is loopback (`127.0.0.1`/`::1`).
* Verify `Host` is `127.0.0.1` or `localhost` (reject all others).

#### 3) Pairing token (second gate)

* Daemon generates a random secret on first run.
* UI must send `Authorization: Bearer <token>` on all non-public endpoints.
* Pairing UX options:

  * **Copy/Paste code**: daemon prints pairing code; UI has input box.
  * **Local confirmation page**: daemon serves `GET /pair` which user visits, clicks “Approve”, daemon issues token.
* Default to the local confirmation page; use copy/paste as a headless fallback.

Token storage:

* Stored locally in daemon config directory (OS-appropriate).
* Store a hash of the token at rest; keep a per-origin token record.
* Support rotation and revocation (per origin).
* Tokens expire after 30 days by default; allow refresh before expiry.
* UI stores token in browser storage (scoped to the UI origin).

#### 4) Workspace sandbox

* Daemon maintains a **workspaceRoot** directory.
* All filesystem paths are resolved to absolute canonical paths.
* Reject if the resolved path is outside `workspaceRoot` (including symlink escapes).
* Clone destinations must be workspace-relative or validated absolute paths inside root.
* On first run, prompt the user to select a workspace root; persist the choice in config.

#### 5) Capability gating (required)

First-time use of high-risk features requires explicit user approval:

* `open-terminal`
* `open-vscode`
* `deps/install`
  Approval is remembered per (origin, repo) tuple, with an option to revoke.

#### 6) No arbitrary command execution

* Only whitelisted commands are implemented.
* Any endpoint that would accept arbitrary args must be constrained/validated.
* Validate `repoUrl` formats (SSH/HTTPS only); disallow `file://` and local paths.

#### 7) Abuse limits (recommended)

* Rate limit pairing attempts and auth failures.
* Cap request body size and path length.

---

## Configuration & Storage

* Use OS-specific config directories:

  * macOS: `~/Library/Application Support/Git Daemon`
  * Linux: `~/.config/git-daemon`
  * Windows: `%APPDATA%\\Git Daemon`
* Store:

  * `config.json` (workspace root, approvals, options)
  * `tokens.json` (hashed tokens, per-origin records)
  * `logs/` (structured logs with rotation)
* Log rotation: keep 5 files × 5MB each.

---

## Git & System Integration

### Git execution strategy

Use **system `git`** via process spawn:

* Supports SSH config, credential helpers, GPG signing, etc.
* Matches user environment and reduces edge cases.

Capture output:

* Stream `stdout`/`stderr` to job logs.
* Parse where useful (e.g., status porcelain).

### Runtime & packaging

* Plain Node.js script written in TypeScript.
* No binary packaging; run via Node (e.g., `node dist/daemon.js` or `npm run daemon`).
* Manual start only; no auto-start or OS service installation.

### Suggested libraries (optional)

* `express` for the HTTP API.
* `cors` with a strict allowlist for Origin handling.
* `zod` or `ajv` for request validation.
* `express-rate-limit` for pairing/auth failure throttles.
* `execa` for spawning git/deps with streamed output.
* `tree-kill` or `pidtree` for cross-platform process-tree termination.
* `env-paths` for OS-correct config directories.
* `pino` + `pino-http` for structured logging.
* `rotating-file-stream` for log rotation.
* `vitest` for unit/integration testing.
* `supertest` for HTTP API testing.

### CLI UX (local)

* Use `prompts` for interactive input flows.
* Use `ora` for status spinners and long-running task feedback.
* Use `chalk` for readable, color-coded output.
* Rationale: lightweight, simple to wire into a daemon with occasional user prompts.

### Testing approach

* Unit tests cover pure validation, path resolution, and policy checks (origins, workspace, capabilities).
* Integration tests start the daemon on an ephemeral port and call HTTP endpoints via `supertest`.
* Use temp directories for workspace roots and repos; never touch user paths.
* Stub Git/deps commands where possible; allow a small set of opt-in, real-git tests behind a flag.
* Validate SSE streams with deterministic event sequences for job lifecycles.

### Credential behavior (native)

* Clone defaults to SSH URL: `git@github.com:OWNER/REPO.git`
* If user prefers HTTPS and has credential helper configured, daemon can support HTTPS clone URL too—still without receiving tokens.

---

## API Design

### Conventions

* JSON request/response.
* Long operations create a **job** and return `jobId`.
* Logs/updates streamed via SSE.
* All “repoPath” inputs must be inside workspace root.
* Use direct responses for short operations; jobs for long-running operations.

### Public endpoints (no token required)

* `GET /v1/meta` → status + version/build + pairing state + capabilities
  * includes a `capabilities` object for tool availability

### Pairing endpoints

* `POST /v1/pair` → `{ step: "start"|"confirm", code? }`

  * `start` returns pairing instructions (and optionally a one-time code)
  * `confirm` exchanges code for `accessToken`

Meta response fields (examples):

* `version: string`
* `build: { commit?: string, date?: string }`
* `pairing: { required: boolean, paired: boolean }`
* `workspace: { configured: boolean, root?: string }`
* `capabilities.tools.pnpm.installed: boolean`
* `capabilities.tools.code.installed: boolean`
* UI uses these to adapt features (e.g., show pnpm options)

### Job endpoints

* `GET /v1/jobs/:id` → status metadata
* `GET /v1/jobs/:id/stream` → SSE stream of log events
* `POST /v1/jobs/:id/cancel` → request cancellation

### Git endpoints

* `POST /v1/git/clone` → job

  * body: `{ repoUrl, destRelative, options?: { branch?, depth? } }`
* `POST /v1/git/fetch` → job

  * body: `{ repoPath, remote?: "origin", prune?: true }`
  * note: fetch updates remote tracking only; no merge/rebase is performed
* `GET /v1/git/status?repoPath=...` → structured status

  * returns: `{ branch, ahead, behind, stagedCount, unstagedCount, untrackedCount, conflictsCount, clean }`

### OS “open” endpoints

* `POST /v1/os/open` → `{ target: "folder"|"terminal"|"vscode", path }`

### Package installation endpoint

* `POST /v1/deps/install` → job

  * body: `{ repoPath, manager?: "auto"|"npm"|"pnpm"|"yarn", mode?: "auto"|"ci"|"install", safer?: boolean }`

Recommendations:

* `manager=auto` chooses based on `packageManager` field / lockfiles / installed tools.
* `safer=true` maps to flags that reduce script execution risk (e.g., `--ignore-scripts` for npm/pnpm/yarn).
* Default to `safer=true` for all runs; allow a per-repo override to enable scripts.

---

## Job Model

### Job states

* `queued` → `running` → `done | error | cancelled`

### Stream event format (SSE)

Each event is JSON:

* `{ type: "log", stream: "stdout"|"stderr", line: "..." }`
* `{ type: "progress", kind: "git"|"deps", percent?: number, detail?: string }`
* `{ type: "state", state: "running"|"done"|"error", message?: string }`

### Cancellation

* Attempt graceful termination:

  * send SIGINT/SIGTERM (platform-dependent)
  * terminate the entire process tree
  * mark cancelled if process exits

### Concurrency & timeouts

* Default to one running job at a time (configurable).
* Enforce a max runtime of 1 hour per job (configurable); return a `timeout` error code.

---

## Dependency Manager Selection

### Detection rules

* Daemon detects presence of tools (`pnpm`, `npm`, `yarn`) via PATH and `--version`.

### Auto selection order (example)

1. If `package.json.packageManager` specifies pnpm/yarn/npm → prefer that manager (if installed)
2. Else if lockfile exists:

   * `pnpm-lock.yaml` → pnpm
   * `yarn.lock` → yarn
   * `package-lock.json` → npm
3. Else fallback to npm

### Command choice

* pnpm: `pnpm install` (add `--frozen-lockfile` for CI/lockfile enforcement; add `--ignore-scripts` when `safer=true`)
* npm:

  * if lockfile exists: `npm ci`
  * else: `npm install`
  * add `--ignore-scripts` when `safer=true`
* yarn: `yarn install` (add `--immutable` if berry is detected; add `--ignore-scripts` when `safer=true`)

---

## Usage Flows

### 1) Hosted UI + daemon (normal user)

1. User opens `https://app.example.com`
2. UI checks daemon: `GET http://127.0.0.1:<port>/v1/meta`
3. If missing: UI shows “Run daemon” instructions (repo clone + `npm run daemon`)
4. Pair once (code/confirm)
5. User clicks “Clone locally”
6. UI calls daemon `/v1/git/clone`, streams job logs
7. UI shows “Open in VS Code / Terminal / Folder”

### 2) Local UI + daemon (dev)

Same, except UI origin is localhost and allowlisted.

### Usage considerations

* Provide a "Fetch" action that does not pull; use it to update ahead/behind indicators before any merge/rebase.
* Avoid implicit pull; all merges/rebases should be explicit, user-driven actions.

---

## Local Setup (developer-oriented)

### Requirements

* Git installed
* Node installed (for running daemon from repo, per your approach)
* Optional:

  * VS Code CLI (`code`) in PATH for “Open VS Code”
  * pnpm installed for pnpm installs

### Typical commands

* `npm install`
* `npm run daemon`

---

## Example Requests (for reference)

### Check meta

```bash
curl -H "Origin: https://app.example.com" \
     http://127.0.0.1:8790/v1/meta
```

### Clone

```bash
curl -X POST \
  -H "Origin: https://app.example.com" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"git@github.com:owner/repo.git","destRelative":"owner/repo"}' \
  http://127.0.0.1:8790/v1/git/clone
```

### Stream job logs (SSE)

```bash
curl -N \
  -H "Origin: https://app.example.com" \
  -H "Authorization: Bearer <TOKEN>" \
  http://127.0.0.1:8790/v1/jobs/<JOB_ID>/stream
```

---

## Error Handling

* `401` missing/invalid bearer token
* `403` origin not allowed
* `404` unknown job/repo
* `409` operation not allowed (e.g., outside workspace, repo not registered)
* `422` invalid input (malformed paths, missing fields)
* `413` request too large
* `429` rate limited
* `500` unexpected failure (include safe diagnostic code)

Errors should include a stable `errorCode` and a user-safe `message`.

Recommended `errorCode` values:

* `auth_required`
* `auth_invalid`
* `origin_not_allowed`
* `rate_limited`
* `request_too_large`
* `workspace_required`
* `path_outside_workspace`
* `invalid_repo_url`
* `capability_not_granted`
* `job_not_found`
* `timeout`
* `internal_error`

---

## Observability & Diagnostics

* `GET /v1/diagnostics` (optional) returns:

  * daemon config summary (redacted)
  * recent errors and job history (limited)
  * log tail and last 20 job summaries
* Structured JSON logs written to `logs/` with request/job IDs.
* Keep the last 100 jobs in memory and the last 50 on disk.
* “Copy debug bundle” flow can zip logs + redacted config + job summaries.

---

## Future Extensions

* Repo registry: “known repos” list for safer operations and better UX
* `git pull`, `checkout`, `branch list`, `log` endpoints
* Support multiple terminals/editors
* Signed request challenge (HMAC) in addition to bearer token

---

## Open Questions (implementation choices)

* How to handle first-time SSH host key verification UX
