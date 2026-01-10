import { createContext } from "./context";
import { createApp } from "./app";
import http from "http";
import https from "https";
import { promises as fs } from "fs";

const start = async () => {
  const ctx = await createContext();
  const app = createApp(ctx);

  const startupSummary = {
    configDir: ctx.configDir,
    host: ctx.config.server.host,
    port: ctx.config.server.port,
    workspaceRoot: ctx.config.workspaceRoot ?? "not configured",
    originAllowlist: ctx.config.originAllowlist,
  };
  ctx.logger.info(startupSummary, "Git Daemon starting");
  if (process.env.GIT_DAEMON_LOG_STDOUT !== "1") {
    console.log("[Git Daemon] Startup");
    console.log(`  config: ${startupSummary.configDir}`);
    console.log(`  host: ${startupSummary.host}`);
    console.log(`  port: ${startupSummary.port}`);
    console.log(`  workspace: ${startupSummary.workspaceRoot}`);
    console.log(
      `  allowlist: ${startupSummary.originAllowlist.join(", ") || "none"}`,
    );
    const httpsConfig = ctx.config.server.https;
    if (httpsConfig?.enabled) {
      console.log(
        `  https: enabled (port ${httpsConfig.port ?? ctx.config.server.port + 1})`,
      );
      console.log(`  https.key: ${httpsConfig.keyPath ?? "missing"}`);
      console.log(`  https.cert: ${httpsConfig.certPath ?? "missing"}`);
    } else {
      console.log("  https: disabled");
    }
  }

  const httpServer = http.createServer(app);
  httpServer.on("error", (err) => {
    ctx.logger.error({ err }, "HTTP server error");
  });
  httpServer.listen(ctx.config.server.port, ctx.config.server.host, () => {
    ctx.logger.info(
      {
        host: ctx.config.server.host,
        port: ctx.config.server.port,
        protocol: "http",
      },
      "Git Daemon listening",
    );
  });

  const httpsConfig = ctx.config.server.https;
  if (httpsConfig?.enabled) {
    if (!httpsConfig.keyPath || !httpsConfig.certPath) {
      throw new Error(
        "HTTPS enabled but keyPath/certPath not configured in server.https.",
      );
    }
    const [key, cert] = await Promise.all([
      fs.readFile(httpsConfig.keyPath),
      fs.readFile(httpsConfig.certPath),
    ]);
    const httpsServer = https.createServer({ key, cert }, app);
    httpsServer.on("error", (err) => {
      ctx.logger.error({ err }, "HTTPS server error");
    });
    const httpsPort = httpsConfig.port ?? ctx.config.server.port + 1;
    httpsServer.listen(httpsPort, ctx.config.server.host, () => {
      ctx.logger.info(
        {
          host: ctx.config.server.host,
          port: httpsPort,
          protocol: "https",
        },
        "Git Daemon listening (TLS)",
      );
    });
  }
};

start().catch((err) => {
  console.error("Failed to start Git Daemon", err);
  process.exit(1);
});
