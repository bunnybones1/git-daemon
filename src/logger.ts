import path from "path";
import { promises as fs } from "fs";
import pino from "pino";
import pinoHttp from "pino-http";
import type { Logger } from "pino";
import rfs from "rotating-file-stream";
import type { AppConfig } from "./types";

export const createLogger = async (
  configDir: string,
  logging: AppConfig["logging"],
  enabled = true,
): Promise<Logger> => {
  const logDir = path.join(configDir, logging.directory);
  await fs.mkdir(logDir, { recursive: true });

  const stream = rfs.createStream("daemon.log", {
    size: `${logging.maxBytes}B`,
    maxFiles: logging.maxFiles,
    path: logDir,
  });

  return pino({ enabled }, stream);
};

export const createHttpLogger = (logger: Logger) => pinoHttp({ logger });
