import { describe, expect, it } from "vitest";
import request from "supertest";
import path from "path";
import os from "os";
import { promises as fs } from "fs";
import pino from "pino";
import { execa } from "execa";
import { createApp, type DaemonContext } from "../src/app";
import { TokenStore } from "../src/tokens";
import { PairingManager } from "../src/pairing";
import { JobManager } from "../src/jobs";
import type { AppConfig } from "../src/types";

const createTempDir = async () =>
  fs.mkdtemp(path.join(os.tmpdir(), "git-daemon-test-"));

const runGit = async (cwd: string, args: string[]) => {
  await execa("git", args, { cwd });
};

const setupRepoWithRemote = async (workspaceRoot: string) => {
  const repoDir = path.join(workspaceRoot, "repo");
  const remoteDir = path.join(workspaceRoot, "remote.git");
  await fs.mkdir(repoDir, { recursive: true });
  await runGit(repoDir, ["init", "-b", "main"]);
  await runGit(repoDir, ["config", "user.email", "test@example.com"]);
  await runGit(repoDir, ["config", "user.name", "Test User"]);
  await fs.writeFile(path.join(repoDir, "README.md"), "hello");
  await runGit(repoDir, ["add", "README.md"]);
  await runGit(repoDir, ["commit", "-m", "init"]);
  await runGit(workspaceRoot, ["init", "--bare", remoteDir]);
  await runGit(repoDir, ["remote", "add", "origin", remoteDir]);
  await runGit(repoDir, ["push", "-u", "origin", "main"]);
  await runGit(repoDir, ["checkout", "-b", "feature"]);
  await fs.writeFile(path.join(repoDir, "feature.txt"), "feature");
  await runGit(repoDir, ["add", "feature.txt"]);
  await runGit(repoDir, ["commit", "-m", "feature"]);
  await runGit(repoDir, ["push", "-u", "origin", "feature"]);
  await runGit(repoDir, ["fetch", "origin"]);
  return { repoPath: "repo" };
};

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

  it("lists branches including remotes by default", async () => {
    const workspaceRoot = await createTempDir();
    const { repoPath } = await setupRepoWithRemote(workspaceRoot);
    const { app, ctx } = await createContext(workspaceRoot, origin);
    const { token } = await ctx.tokenStore.issueToken(origin, 30);

    const res = await request(app)
      .get("/v1/git/branches")
      .query({ repoPath })
      .set("Origin", origin)
      .set("Host", "127.0.0.1")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const branches = res.body.branches as Array<{
      name: string;
      type: "local" | "remote";
      current: boolean;
    }>;
    const names = branches.map((branch) => branch.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "main",
        "feature",
        "origin/main",
        "origin/feature",
      ]),
    );
    const current = branches.find((branch) => branch.current);
    expect(current?.name).toBe("feature");
    const originMain = branches.find((branch) => branch.name === "origin/main");
    expect(originMain?.type).toBe("remote");
  });

  it("returns a UI-friendly status summary", async () => {
    const workspaceRoot = await createTempDir();
    const { repoPath } = await setupRepoWithRemote(workspaceRoot);
    const repoDir = path.join(workspaceRoot, repoPath);
    await fs.writeFile(path.join(repoDir, "scratch.txt"), "dirty");
    const { app, ctx } = await createContext(workspaceRoot, origin);
    const { token } = await ctx.tokenStore.issueToken(origin, 30);

    const res = await request(app)
      .get("/v1/git/summary")
      .query({ repoPath })
      .set("Origin", origin)
      .set("Host", "127.0.0.1")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.repoPath).toBe(repoPath);
    expect(res.body.exists).toBe(true);
    expect(res.body.branch).toBe("feature");
    expect(res.body.upstream).toBe("origin/feature");
    expect(res.body.ahead).toBe(0);
    expect(res.body.behind).toBe(0);
    expect(res.body.dirty).toBe(true);
    expect(res.body.untracked).toBe(1);
    expect(res.body.staged).toBe(0);
    expect(res.body.unstaged).toBe(0);
    expect(res.body.conflicts).toBe(0);
    expect(res.body.detached).toBe(false);
  });

  it("returns exists false when summary repo is missing", async () => {
    const workspaceRoot = await createTempDir();
    const { app, ctx } = await createContext(workspaceRoot, origin);
    const { token } = await ctx.tokenStore.issueToken(origin, 30);

    const res = await request(app)
      .get("/v1/git/summary")
      .query({ repoPath: "missing" })
      .set("Origin", origin)
      .set("Host", "127.0.0.1")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
    expect(res.body.branch).toBe("");
    expect(res.body.dirty).toBe(false);
    expect(res.body.ahead).toBe(0);
    expect(res.body.behind).toBe(0);
  });
});
