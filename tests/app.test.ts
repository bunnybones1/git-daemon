import { describe, expect, it } from "vitest";
import request from "supertest";
import path from "path";
import os from "os";
import { promises as fs } from "fs";
import pino from "pino";
import { createApp, type DaemonContext } from "../src/app";
import { TokenStore } from "../src/tokens";
import { PairingManager } from "../src/pairing";
import { JobManager } from "../src/jobs";
import type { AppConfig } from "../src/types";

const createTempDir = async () =>
  fs.mkdtemp(path.join(os.tmpdir(), "git-daemon-test-"));

const createConfig = (
  workspaceRoot: string | null,
  origin: string,
): AppConfig => ({
  configVersion: 1,
  server: { host: "127.0.0.1", port: 0 },
  originAllowlist: [origin],
  workspaceRoot,
  pairing: { tokenTtlDays: 30 },
  jobs: { maxConcurrent: 1, timeoutSeconds: 60 },
  deps: { defaultSafer: true },
  logging: { directory: "logs", maxFiles: 1, maxBytes: 1024 },
  approvals: { entries: [] },
});

const createContext = async (workspaceRoot: string | null, origin: string) => {
  const configDir = await createTempDir();
  const config = createConfig(workspaceRoot, origin);
  const tokenStore = new TokenStore(configDir);
  await tokenStore.load();
  const pairingManager = new PairingManager(
    tokenStore,
    config.pairing.tokenTtlDays,
  );
  const jobManager = new JobManager(
    config.jobs.maxConcurrent,
    config.jobs.timeoutSeconds,
  );
  const logger = pino({ enabled: false });
  const capabilities = { tools: {} };
  const ctx: DaemonContext = {
    config,
    configDir,
    tokenStore,
    pairingManager,
    jobManager,
    capabilities,
    logger,
    version: "0.1.0",
    build: undefined,
  };
  return { ctx, app: createApp(ctx) };
};

describe("Git Daemon API", () => {
  const origin = "http://localhost:5173";

  it("rejects missing Origin header", async () => {
    const { app } = await createContext(null, origin);
    const res = await request(app).get("/v1/meta").set("Host", "127.0.0.1");
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe("origin_not_allowed");
  });

  it("returns meta for allowed origin", async () => {
    const { app } = await createContext(null, origin);
    const res = await request(app)
      .get("/v1/meta")
      .set("Origin", origin)
      .set("Host", "127.0.0.1");
    expect(res.status).toBe(200);
    expect(res.body.version).toBeTypeOf("string");
    expect(res.body.pairing).toBeTruthy();
  });

  it("requires auth for protected routes", async () => {
    const { app } = await createContext(null, origin);
    const res = await request(app)
      .get("/v1/git/status")
      .query({ repoPath: "repo" })
      .set("Origin", origin)
      .set("Host", "127.0.0.1");
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe("auth_required");
  });

  it("returns workspace_required when not configured", async () => {
    const { app, ctx } = await createContext(null, origin);
    const { token } = await ctx.tokenStore.issueToken(origin, 30);

    const res = await request(app)
      .get("/v1/git/status")
      .query({ repoPath: "repo" })
      .set("Origin", origin)
      .set("Host", "127.0.0.1")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe("workspace_required");
  });

  it("validates repoUrl on clone", async () => {
    const workspaceRoot = await createTempDir();
    const { app, ctx } = await createContext(workspaceRoot, origin);
    const { token } = await ctx.tokenStore.issueToken(origin, 30);

    const res = await request(app)
      .post("/v1/git/clone")
      .set("Origin", origin)
      .set("Host", "127.0.0.1")
      .set("Authorization", `Bearer ${token}`)
      .send({ repoUrl: "file:///tmp/repo", destRelative: "repo" });

    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe("invalid_repo_url");
  });
});
