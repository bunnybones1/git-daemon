import path from "path";
import { promises as fs } from "fs";
import type { JobContext } from "./jobs";
import { runCommand } from "./process";
import { resolveInsideWorkspace } from "./workspace";
import { isToolInstalled } from "./tools";

export type DepsRequest = {
  repoPath: string;
  manager: "auto" | "npm" | "pnpm" | "yarn";
  mode: "auto" | "ci" | "install";
  safer: boolean;
};

export const installDeps = async (
  ctx: JobContext,
  workspaceRoot: string,
  request: DepsRequest,
) => {
  const repoPath = await resolveInsideWorkspace(
    workspaceRoot,
    request.repoPath,
  );
  await fs.access(path.join(repoPath, "package.json"));

  const manager = await selectManager(repoPath, request.manager);
  const { command, args } = await buildInstallCommand(
    repoPath,
    manager,
    request.mode,
    request.safer,
  );

  ctx.progress({ kind: "deps", detail: `${command} ${args.join(" ")}` });
  await runCommand(ctx, command, args, { cwd: repoPath });
};

const selectManager = async (
  repoPath: string,
  requested: DepsRequest["manager"],
) => {
  if (requested !== "auto") {
    const installed = await isToolInstalled(requested);
    if (!installed) {
      throw new Error(`${requested} is not installed.`);
    }
    return requested;
  }

  const packageManager = await readPackageManager(repoPath);
  if (packageManager) {
    const name = packageManager.split("@")[0];
    if (name === "pnpm" || name === "yarn" || name === "npm") {
      const installed = await isToolInstalled(name);
      if (installed) {
        return name;
      }
    }
  }

  if (await fileExists(path.join(repoPath, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (await fileExists(path.join(repoPath, "yarn.lock"))) {
    return "yarn";
  }
  if (await fileExists(path.join(repoPath, "package-lock.json"))) {
    return "npm";
  }
  return "npm";
};

const readPackageManager = async (repoPath: string) => {
  try {
    const raw = await fs.readFile(path.join(repoPath, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { packageManager?: string };
    return parsed.packageManager;
  } catch {
    return null;
  }
};

const buildInstallCommand = async (
  repoPath: string,
  manager: "npm" | "pnpm" | "yarn",
  mode: "auto" | "ci" | "install",
  safer: boolean,
) => {
  const lockfileExists = await hasAnyLockfile(repoPath);
  const useCi = mode === "ci" || (mode === "auto" && lockfileExists);

  if (manager === "pnpm") {
    const args = ["install"];
    if (useCi) {
      args.push("--frozen-lockfile");
    }
    if (safer) {
      args.push("--ignore-scripts");
    }
    return { command: "pnpm", args };
  }

  if (manager === "yarn") {
    const args = ["install"];
    const isBerry = await fileExists(path.join(repoPath, ".yarnrc.yml"));
    if (useCi || isBerry) {
      args.push("--immutable");
    }
    if (safer) {
      args.push("--ignore-scripts");
    }
    return { command: "yarn", args };
  }

  const args = [useCi ? "ci" : "install"];
  if (safer) {
    args.push("--ignore-scripts");
  }
  return { command: "npm", args };
};

const hasAnyLockfile = async (repoPath: string) =>
  (await fileExists(path.join(repoPath, "pnpm-lock.yaml"))) ||
  (await fileExists(path.join(repoPath, "yarn.lock"))) ||
  (await fileExists(path.join(repoPath, "package-lock.json")));

const fileExists = async (target: string) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};
