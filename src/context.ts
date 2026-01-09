import path from "path";
import { promises as fs } from "fs";
import { createLogger } from "./logger";
import { detectCapabilities } from "./tools";
import { getConfigDir, loadConfig } from "./config";
import { TokenStore } from "./tokens";
import { PairingManager } from "./pairing";
import { JobManager } from "./jobs";
import type { DaemonContext } from "./app";

const readPackageVersion = async () => {
  try {
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const raw = await fs.readFile(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
};

export const createContext = async (): Promise<DaemonContext> => {
  const configDir = getConfigDir();
  const config = await loadConfig(configDir);

  if (!config.originAllowlist.length) {
    throw new Error("originAllowlist must contain at least one entry.");
  }
  if (config.server.host !== "127.0.0.1") {
    throw new Error("Server host must be 127.0.0.1 for loopback-only binding.");
  }

  const tokenStore = new TokenStore(configDir);
  await tokenStore.load();

  const logger = await createLogger(configDir, config.logging);
  const capabilities = await detectCapabilities();
  const pairingManager = new PairingManager(
    tokenStore,
    config.pairing.tokenTtlDays,
  );
  const jobManager = new JobManager(
    config.jobs.maxConcurrent,
    config.jobs.timeoutSeconds,
  );

  const version = await readPackageVersion();
  const build = {
    commit: process.env.GIT_DAEMON_BUILD_COMMIT,
    date: process.env.GIT_DAEMON_BUILD_DATE,
  };

  return {
    config,
    configDir,
    tokenStore,
    pairingManager,
    jobManager,
    capabilities,
    logger,
    version,
    build,
  };
};
