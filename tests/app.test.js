"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = require("fs");
const pino_1 = __importDefault(require("pino"));
const app_1 = require("../src/app");
const tokens_1 = require("../src/tokens");
const pairing_1 = require("../src/pairing");
const jobs_1 = require("../src/jobs");
const createTempDir = async () => fs_1.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), "git-daemon-test-"));
const createConfig = (workspaceRoot, origin) => ({
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
const createContext = async (workspaceRoot, origin) => {
    const configDir = await createTempDir();
    const config = createConfig(workspaceRoot, origin);
    const tokenStore = new tokens_1.TokenStore(configDir);
    await tokenStore.load();
    const pairingManager = new pairing_1.PairingManager(tokenStore, config.pairing.tokenTtlDays);
    const jobManager = new jobs_1.JobManager(config.jobs.maxConcurrent, config.jobs.timeoutSeconds);
    const logger = (0, pino_1.default)({ enabled: false });
    const capabilities = { tools: {} };
    const ctx = {
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
    return { ctx, app: (0, app_1.createApp)(ctx) };
};
(0, vitest_1.describe)("Git Daemon API", () => {
    const origin = "http://localhost:5173";
    (0, vitest_1.it)("rejects missing Origin header", async () => {
        const { app } = await createContext(null, origin);
        const res = await (0, supertest_1.default)(app).get("/v1/meta").set("Host", "127.0.0.1");
        (0, vitest_1.expect)(res.status).toBe(403);
        (0, vitest_1.expect)(res.body.errorCode).toBe("origin_not_allowed");
    });
    (0, vitest_1.it)("returns meta for allowed origin", async () => {
        const { app } = await createContext(null, origin);
        const res = await (0, supertest_1.default)(app)
            .get("/v1/meta")
            .set("Origin", origin)
            .set("Host", "127.0.0.1");
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.version).toBeTypeOf("string");
        (0, vitest_1.expect)(res.body.pairing).toBeTruthy();
    });
    (0, vitest_1.it)("requires auth for protected routes", async () => {
        const { app } = await createContext(null, origin);
        const res = await (0, supertest_1.default)(app)
            .get("/v1/git/status")
            .query({ repoPath: "repo" })
            .set("Origin", origin)
            .set("Host", "127.0.0.1");
        (0, vitest_1.expect)(res.status).toBe(401);
        (0, vitest_1.expect)(res.body.errorCode).toBe("auth_required");
    });
    (0, vitest_1.it)("returns workspace_required when not configured", async () => {
        const { app, ctx } = await createContext(null, origin);
        const { token } = await ctx.tokenStore.issueToken(origin, 30);
        const res = await (0, supertest_1.default)(app)
            .get("/v1/git/status")
            .query({ repoPath: "repo" })
            .set("Origin", origin)
            .set("Host", "127.0.0.1")
            .set("Authorization", `Bearer ${token}`);
        (0, vitest_1.expect)(res.status).toBe(409);
        (0, vitest_1.expect)(res.body.errorCode).toBe("workspace_required");
    });
    (0, vitest_1.it)("validates repoUrl on clone", async () => {
        const workspaceRoot = await createTempDir();
        const { app, ctx } = await createContext(workspaceRoot, origin);
        const { token } = await ctx.tokenStore.issueToken(origin, 30);
        const res = await (0, supertest_1.default)(app)
            .post("/v1/git/clone")
            .set("Origin", origin)
            .set("Host", "127.0.0.1")
            .set("Authorization", `Bearer ${token}`)
            .send({ repoUrl: "file:///tmp/repo", destRelative: "repo" });
        (0, vitest_1.expect)(res.status).toBe(422);
        (0, vitest_1.expect)(res.body.errorCode).toBe("invalid_repo_url");
    });
});
