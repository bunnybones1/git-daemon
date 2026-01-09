import envPaths from "env-paths";
import path from "path";
import { promises as fs } from "fs";
import type { AppConfig } from "./types";

const CONFIG_VERSION = 1;
const CONFIG_FILE = "config.json";
const TOKENS_FILE = "tokens.json";

export const getConfigDir = () => {
  const override = process.env.GIT_DAEMON_CONFIG_DIR;
  if (override) {
    return override;
  }
  const paths = envPaths("Git Daemon", { suffix: "" });
  return paths.config;
};

export const getConfigPath = (configDir: string) =>
  path.join(configDir, CONFIG_FILE);

export const getTokensPath = (configDir: string) =>
  path.join(configDir, TOKENS_FILE);

export const defaultConfig = (): AppConfig => ({
  configVersion: CONFIG_VERSION,
  server: {
    host: "127.0.0.1",
    port: 8790,
  },
  originAllowlist: ["https://app.example.com"],
  workspaceRoot: null,
  pairing: {
    tokenTtlDays: 30,
  },
  jobs: {
    maxConcurrent: 1,
    timeoutSeconds: 3600,
  },
  deps: {
    defaultSafer: true,
  },
  logging: {
    directory: "logs",
    maxFiles: 5,
    maxBytes: 5 * 1024 * 1024,
  },
  approvals: {
    entries: [],
  },
});

export const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true });
};

export const loadConfig = async (configDir: string): Promise<AppConfig> => {
  await ensureDir(configDir);
  const configPath = getConfigPath(configDir);
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const data = JSON.parse(raw) as AppConfig;
    return {
      ...defaultConfig(),
      ...data,
      server: {
        ...defaultConfig().server,
        ...data.server,
      },
      pairing: {
        ...defaultConfig().pairing,
        ...data.pairing,
      },
      jobs: {
        ...defaultConfig().jobs,
        ...data.jobs,
      },
      deps: {
        ...defaultConfig().deps,
        ...data.deps,
      },
      logging: {
        ...defaultConfig().logging,
        ...data.logging,
      },
      approvals: {
        entries: data.approvals?.entries ?? [],
      },
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
    const config = defaultConfig();
    await saveConfig(configDir, config);
    return config;
  }
};

export const saveConfig = async (configDir: string, config: AppConfig) => {
  const configPath = getConfigPath(configDir);
  await ensureDir(configDir);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
};
