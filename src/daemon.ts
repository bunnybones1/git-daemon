import { createContext } from "./context";
import { createApp } from "./app";

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
    console.log(
      `[Git Daemon] config=${startupSummary.configDir} host=${startupSummary.host} port=${startupSummary.port}`,
    );
  }

  app.listen(ctx.config.server.port, ctx.config.server.host, () => {
    ctx.logger.info(
      {
        host: ctx.config.server.host,
        port: ctx.config.server.port,
      },
      "Git Daemon listening",
    );
  });
};

start().catch((err) => {
  console.error("Failed to start Git Daemon", err);
  process.exit(1);
});
