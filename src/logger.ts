import path from "path";
import { promises as fs } from "fs";
import pino from "pino";
import pinoHttp from "pino-http";
import type { Logger } from "pino";
import { createStream } from "rotating-file-stream";
import type { AppConfig } from "./types";

export const createLogger = async (
  configDir: string,
  logging: AppConfig["logging"],
  enabled = true,
): Promise<Logger> => {
  const level = process.env.GIT_DAEMON_LOG_LEVEL || "info";
  const logToStdout = process.env.GIT_DAEMON_LOG_STDOUT === "1";
  const prettyStdout = logToStdout && process.env.GIT_DAEMON_LOG_PRETTY !== "0";
  const logDir = path.join(configDir, logging.directory);
  await fs.mkdir(logDir, { recursive: true });

  const stream = createStream("daemon.log", {
    size: `${logging.maxBytes}B`,
    maxFiles: logging.maxFiles,
    path: logDir,
  });

  if (!logToStdout) {
    return pino({ enabled, level }, stream);
  }

  const streams: Array<{ stream: NodeJS.WritableStream }> = [{ stream }];
  if (prettyStdout) {
    const { default: pretty } = await import("pino-pretty");
    streams.push({
      stream: pretty({
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      }),
    });
  } else {
    streams.push({ stream: process.stdout });
  }

  return pino({ enabled, level }, (pino as any).multistream(streams));
};

export const createHttpLogger = (logger: Logger) =>
  pinoHttp({ logger: logger as any });
