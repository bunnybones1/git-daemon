import { createContext } from "./context";
import { createApp } from "./app";

const start = async () => {
  const ctx = await createContext();
  const app = createApp(ctx);

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
