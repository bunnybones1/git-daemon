import express from "express";
import rateLimit from "express-rate-limit";
import type { Logger } from "pino";
import type { Request, Response, NextFunction } from "express";
import { promises as fs } from "fs";
import * as fsSync from "fs";
import path from "path";
import readline from "readline";
import { createHttpLogger } from "./logger";
import type { AppConfig, Capabilities } from "./types";
import {
  authGuard,
  getOrigin,
  hostGuard,
  loopbackGuard,
  originGuard,
} from "./security";
import {
  errorBody,
  ApiError,
  internalError,
  jobNotFound,
  pathNotFound,
  rateLimited,
  repoNotFound,
} from "./errors";
import {
  pairRequestSchema,
  gitCloneRequestSchema,
  gitFetchRequestSchema,
  gitStatusQuerySchema,
  osOpenRequestSchema,
  depsInstallRequestSchema,
} from "./validation";
import {
  ensureWorkspaceRoot,
  resolveInsideWorkspace,
  ensureRelative,
  MissingPathError,
} from "./workspace";
import {
  cloneRepo,
  fetchRepo,
  getRepoStatus,
  RepoNotFoundError,
  resolveRepoPath,
} from "./git";
import { installDeps } from "./deps";
import { openTarget } from "./os";
import type { TokenStore } from "./tokens";
import type { PairingManager } from "./pairing";
import type { JobManager } from "./jobs";
import { hasApproval, requireApproval } from "./approvals";
import { saveConfig } from "./config";

export type DaemonContext = {
  config: AppConfig;
  configDir: string;
  tokenStore: TokenStore;
  pairingManager: PairingManager;
  jobManager: JobManager;
  capabilities: Capabilities;
  logger: Logger;
  version: string;
  build?: { commit?: string; date?: string };
};

const parseBody = <T>(
  schema: {
    safeParse: (
      input: unknown,
    ) =>
      | { success: true; data: T }
      | { success: false; error: { issues: { path: (string | number)[] }[] } };
  },
  body: unknown,
  opts?: { repoUrl?: boolean },
): T => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    if (
      opts?.repoUrl &&
      parsed.error.issues.some((issue) => issue.path.includes("repoUrl"))
    ) {
      throw new ApiError(
        422,
        errorBody("invalid_repo_url", "Repository URL is invalid."),
      );
    }
    throw new ApiError(422, errorBody("internal_error", "Invalid input."));
  }
  return parsed.data;
};

const rateLimitHandler = (_req: Request, res: Response) => {
  const body = rateLimited().body;
  res.status(429).json(body);
};

export const createApp = (ctx: DaemonContext) => {
  const app = express();
  app.disable("x-powered-by");

  app.use(createHttpLogger(ctx.logger));
  app.use(express.json({ limit: "256kb" }));
  app.use(loopbackGuard());
  app.use(hostGuard());
  app.use(originGuard(ctx.config.originAllowlist));

  app.use(
    "/v1",
    rateLimit({
      windowMs: 5 * 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      handler: rateLimitHandler,
    }),
  );

  app.get("/v1/meta", (_req, res) => {
    const origin = getOrigin(_req);
    const pairingRecord = ctx.tokenStore.getActiveToken(origin);
    res.json({
      version: ctx.version,
      build: ctx.build,
      pairing: {
        required: true,
        paired: Boolean(pairingRecord),
      },
      workspace: {
        configured: Boolean(ctx.config.workspaceRoot),
        root: ctx.config.workspaceRoot ?? undefined,
      },
      capabilities: ctx.capabilities,
    });
  });

  app.post(
    "/v1/pair",
    rateLimit({
      windowMs: 10 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      handler: rateLimitHandler,
    }),
    async (req, res, next) => {
      try {
        const origin = getOrigin(req);
        const payload = parseBody(pairRequestSchema, req.body);
        if (payload.step === "start") {
          res.json(ctx.pairingManager.start(origin));
          return;
        }
        const response = await ctx.pairingManager.confirm(origin, payload.code);
        if (!response) {
          throw new ApiError(
            422,
            errorBody("internal_error", "Invalid pairing code."),
          );
        }
        res.json(response);
      } catch (err) {
        next(err);
      }
    },
  );

  app.get("/v1/jobs/:id", authGuard(ctx.tokenStore), (req, res, next) => {
    try {
      const job = ctx.jobManager.get(req.params.id);
      if (!job) {
        throw jobNotFound();
      }
      res.json(job.snapshot());
    } catch (err) {
      next(err);
    }
  });

  app.get(
    "/v1/jobs/:id/stream",
    authGuard(ctx.tokenStore),
    (req, res, next) => {
      const job = ctx.jobManager.get(req.params.id);
      if (!job) {
        next(jobNotFound());
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();

      const sendEvent = (event: unknown) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const isTerminalState = (event: unknown) => {
        if (!event || typeof event !== "object") {
          return false;
        }
        const record = event as { type?: string; state?: string };
        return (
          record.type === "state" &&
          (record.state === "done" ||
            record.state === "error" ||
            record.state === "cancelled")
        );
      };

      for (const event of job.events) {
        sendEvent(event);
        if (isTerminalState(event)) {
          res.end();
          return;
        }
      }

      const listener = (event: unknown) => {
        sendEvent(event);
        if (isTerminalState(event)) {
          job.emitter.off("event", listener);
          res.end();
        }
      };
      job.emitter.on("event", listener);

      req.on("close", () => {
        job.emitter.off("event", listener);
      });
    },
  );

  app.post(
    "/v1/jobs/:id/cancel",
    authGuard(ctx.tokenStore),
    (req, res, next) => {
      try {
        const job = ctx.jobManager.get(req.params.id);
        if (!job) {
          throw jobNotFound();
        }
        if (job.state !== "queued" && job.state !== "running") {
          res
            .status(409)
            .json(errorBody("internal_error", "Job is not cancellable."));
          return;
        }
        ctx.jobManager.cancel(job.id);
        res.json({ accepted: true });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    "/v1/git/clone",
    authGuard(ctx.tokenStore),
    async (req, res, next) => {
      try {
        const payload = parseBody(gitCloneRequestSchema, req.body, {
          repoUrl: true,
        });
        const workspaceRoot = ensureWorkspaceRoot(ctx.config.workspaceRoot);
        ensureRelative(payload.destRelative);
        const destPath = await resolveInsideWorkspace(
          workspaceRoot,
          payload.destRelative,
          true,
        );
        try {
          await fs.access(destPath);
          res
            .status(409)
            .json(errorBody("internal_error", "Destination already exists."));
          return;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            throw err;
          }
        }
        await fs.mkdir(path.dirname(destPath), { recursive: true });

        const job = ctx.jobManager.enqueue(async (jobCtx) => {
          await cloneRepo(
            jobCtx,
            workspaceRoot,
            payload.repoUrl,
            payload.destRelative,
            payload.options,
          );
        });
        res.status(202).json({ jobId: job.id });
      } catch (err) {
        next(err);
      }
    },
  );

  app.post(
    "/v1/git/fetch",
    authGuard(ctx.tokenStore),
    async (req, res, next) => {
      try {
        const payload = parseBody(gitFetchRequestSchema, req.body);
        const workspaceRoot = ensureWorkspaceRoot(ctx.config.workspaceRoot);
        await resolveRepoPath(workspaceRoot, payload.repoPath);
        const job = ctx.jobManager.enqueue(async (jobCtx) => {
          await fetchRepo(
            jobCtx,
            workspaceRoot,
            payload.repoPath,
            payload.remote,
            payload.prune,
          );
        });
        res.status(202).json({ jobId: job.id });
      } catch (err) {
        if (
          err instanceof RepoNotFoundError ||
          err instanceof MissingPathError
        ) {
          next(repoNotFound());
          return;
        }
        next(err);
      }
    },
  );

  app.get(
    "/v1/git/status",
    authGuard(ctx.tokenStore),
    async (req, res, next) => {
      try {
        const { repoPath } = parseBody(gitStatusQuerySchema, req.query);
        const workspaceRoot = ensureWorkspaceRoot(ctx.config.workspaceRoot);
        const status = await getRepoStatus(workspaceRoot, repoPath);
        res.json(status);
      } catch (err) {
        if (
          err instanceof RepoNotFoundError ||
          err instanceof MissingPathError
        ) {
          next(repoNotFound());
          return;
        }
        next(err);
      }
    },
  );

  app.post("/v1/os/open", authGuard(ctx.tokenStore), async (req, res, next) => {
    try {
      const origin = getOrigin(req);
      const payload = parseBody(osOpenRequestSchema, req.body);
      const workspaceRoot = ensureWorkspaceRoot(ctx.config.workspaceRoot);
      const resolved = await resolveInsideWorkspace(
        workspaceRoot,
        payload.path,
      );

      if (payload.target === "terminal") {
        await ensureApproval(
          ctx,
          origin,
          resolved,
          "open-terminal",
          workspaceRoot,
        );
      }
      if (payload.target === "vscode") {
        await ensureApproval(
          ctx,
          origin,
          resolved,
          "open-vscode",
          workspaceRoot,
        );
      }

      await openTarget(payload.target, resolved);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof MissingPathError) {
        next(pathNotFound());
        return;
      }
      next(err);
    }
  });

  app.post(
    "/v1/deps/install",
    authGuard(ctx.tokenStore),
    async (req, res, next) => {
      try {
        const origin = getOrigin(req);
        const payload = parseBody(depsInstallRequestSchema, req.body);
        const workspaceRoot = ensureWorkspaceRoot(ctx.config.workspaceRoot);
        const resolved = await resolveInsideWorkspace(
          workspaceRoot,
          payload.repoPath,
        );
        try {
          await fs.access(path.join(resolved, "package.json"));
        } catch {
          throw repoNotFound();
        }
        await ensureApproval(
          ctx,
          origin,
          resolved,
          "deps/install",
          workspaceRoot,
        );

        const job = ctx.jobManager.enqueue(async (jobCtx) => {
          await installDeps(jobCtx, workspaceRoot, {
            repoPath: payload.repoPath,
            manager: payload.manager ?? "auto",
            mode: payload.mode ?? "auto",
            safer: payload.safer ?? ctx.config.deps.defaultSafer,
          });
        });

        res.status(202).json({ jobId: job.id });
      } catch (err) {
        if (err instanceof MissingPathError) {
          next(pathNotFound());
          return;
        }
        next(err);
      }
    },
  );

  app.get("/v1/diagnostics", authGuard(ctx.tokenStore), (req, res, next) => {
    try {
      const summary = {
        configVersion: ctx.config.configVersion,
        server: ctx.config.server,
        originAllowlist: ctx.config.originAllowlist,
        workspaceRoot: ctx.config.workspaceRoot,
        pairing: ctx.config.pairing,
        jobs: ctx.config.jobs,
        deps: ctx.config.deps,
        logging: ctx.config.logging,
      };
      res.json({
        config: summary,
        recentErrors: [],
        jobs: ctx.jobManager.listRecent(),
        logTail: [],
      });
    } catch (err) {
      next(err);
    }
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      if (err.status === 409) {
        console.warn(
          `[Git Daemon] 409 ${err.body.errorCode} ${req.method} ${req.originalUrl} origin=${req.headers.origin ?? ""}`,
        );
        ctx.logger.warn(
          {
            errorCode: err.body.errorCode,
            method: req.method,
            path: req.originalUrl,
            origin: req.headers.origin,
          },
          "Request rejected with conflict",
        );
      }
      res.status(err.status).json(err.body);
      return;
    }
    if ((err as { type?: string }).type === "entity.too.large") {
      res
        .status(413)
        .json(errorBody("request_too_large", "Request too large."));
      return;
    }
    ctx.logger.error({ err }, "Unhandled error");
    const fallback = internalError();
    res.status(fallback.status).json(fallback.body);
  });

  return app;
};

const ensureApproval = async (
  ctx: DaemonContext,
  origin: string,
  repoPath: string,
  capability: "open-terminal" | "open-vscode" | "deps/install",
  workspaceRoot?: string | null,
) => {
  if (hasApproval(ctx.config, origin, repoPath, capability, workspaceRoot)) {
    return;
  }
  const approved = await promptApproval(origin, repoPath, capability);
  if (!approved) {
    requireApproval(ctx.config, origin, repoPath, capability, workspaceRoot);
    return;
  }
  upsertOriginApproval(ctx, origin, capability);
  await saveConfig(ctx.configDir, ctx.config);
};

const createPromptInterface = () => {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  const ttyPath = process.platform === "win32" ? "CON" : "/dev/tty";
  try {
    const input = fsSync.createReadStream(ttyPath, { encoding: "utf8" });
    const output = fsSync.createWriteStream(ttyPath);
    return readline.createInterface({ input, output });
  } catch {
    return null;
  }
};

const askQuestion = (rl: readline.Interface, question: string) =>
  new Promise<string>((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });

const promptApproval = async (
  origin: string,
  repoPath: string,
  capability: string,
) => {
  const rl = createPromptInterface();
  if (!rl) {
    return false;
  }
  const answer = await askQuestion(
    rl,
    `Approve ${capability} for origin ${origin} (all repos)? [y/N] Requested path: ${repoPath} `,
  );
  rl.close();
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
};

const upsertOriginApproval = (
  ctx: DaemonContext,
  origin: string,
  capability: "open-terminal" | "open-vscode" | "deps/install",
) => {
  const existing = ctx.config.approvals.entries.find(
    (entry) =>
      entry.origin === origin &&
      (entry.repoPath === null || entry.repoPath === "*"),
  );
  if (existing) {
    if (!existing.capabilities.includes(capability)) {
      existing.capabilities.push(capability);
    }
    return;
  }
  ctx.config.approvals.entries.push({
    origin,
    repoPath: null,
    capabilities: [capability],
    approvedAt: new Date().toISOString(),
  });
};
