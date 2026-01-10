import path from "path";
import os from "os";
import { promises as fs } from "fs";
import * as fsSync from "fs";
import readline from "readline";
import { getConfigDir, loadConfig, saveConfig } from "./config";

const expandHome = (input: string) => {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
};

const pathExists = async (target: string) => {
  try {
    const stats = await fs.stat(target);
    return stats.isDirectory();
  } catch {
    return false;
  }
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

const promptForWorkspace = async (
  rl: readline.Interface,
  initialValue: string,
) => {
  let result: string | null = null;
  while (result === null) {
    const answer = await askQuestion(
      rl,
      `Workspace root directory (absolute path) [${initialValue}]: `,
    );
    const trimmed = answer.trim();
    const value = trimmed.length > 0 ? trimmed : initialValue;
    if (!value) {
      return null;
    }
    const expanded = expandHome(value);
    if (!path.isAbsolute(expanded)) {
      console.log("Workspace root must be an absolute path.");
      continue;
    }
    result = value;
  }
  return result;
};

const promptYesNo = async (
  rl: readline.Interface,
  message: string,
  defaultValue: boolean,
) => {
  const suffix = defaultValue ? "[Y/n]" : "[y/N]";
  const answer = await askQuestion(rl, `${message} ${suffix} `);
  const normalized = answer.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return normalized === "y" || normalized === "yes";
};

const readWorkspaceArg = () => {
  const args = process.argv.slice(2);
  const flagIndex = args.findIndex((arg) => arg === "--workspace");
  if (flagIndex >= 0 && args[flagIndex + 1]) {
    return args[flagIndex + 1];
  }
  const inline = args.find((arg) => arg.startsWith("--workspace="));
  if (inline) {
    return inline.split("=").slice(1).join("=");
  }
  return null;
};

const setup = async () => {
  const configDir = getConfigDir();
  const config = await loadConfig(configDir);

  console.log(`[Git Daemon setup] config=${configDir}`);

  const provided = process.env.GIT_DAEMON_WORKSPACE_ROOT || readWorkspaceArg();

  let workspaceInput: string | null | undefined = provided?.trim();
  let rl: readline.Interface | null = null;

  if (!workspaceInput) {
    rl = createPromptInterface();
    if (!rl) {
      console.error(
        "No interactive prompt available. Use GIT_DAEMON_WORKSPACE_ROOT=/path or --workspace=/path.",
      );
      process.exit(1);
    }
    workspaceInput = await promptForWorkspace(
      rl,
      config.workspaceRoot ?? process.cwd(),
    );
  }

  if (!workspaceInput) {
    console.error("Workspace root was not provided.");
    process.exit(1);
  }

  const expanded = expandHome(workspaceInput);
  const resolved = path.resolve(expanded);

  if (!(await pathExists(resolved))) {
    if (!rl) {
      rl = createPromptInterface();
    }
    if (!rl) {
      console.error(`Directory does not exist: ${resolved}`);
      console.error("Create it manually, then rerun setup.");
      process.exit(1);
    }
    const create = await promptYesNo(
      rl,
      `Directory does not exist. Create ${resolved}?`,
      true,
    );
    if (!create) {
      console.log("Setup aborted. Workspace root not saved.");
      process.exit(1);
    }
    await fs.mkdir(resolved, { recursive: true });
  }

  config.workspaceRoot = resolved;
  await saveConfig(configDir, config);

  console.log(`Workspace root set to ${resolved}`);
  rl?.close();
};

setup().catch((err) => {
  console.error("Setup failed", err);
  process.exit(1);
});
