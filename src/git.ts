import path from "path";
import { promises as fs } from "fs";
import type { JobContext } from "./jobs";
import { runCommand } from "./process";
import { resolveInsideWorkspace, ensureRelative } from "./workspace";

export type GitStatus = {
  branch: string;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictsCount: number;
  clean: boolean;
};

export class RepoNotFoundError extends Error {}

export const cloneRepo = async (
  ctx: JobContext,
  workspaceRoot: string,
  repoUrl: string,
  destRelative: string,
  options?: { branch?: string; depth?: number },
) => {
  ensureRelative(destRelative);
  const destPath = await resolveInsideWorkspace(
    workspaceRoot,
    destRelative,
    true,
  );

  const args = ["clone", repoUrl, destPath];
  if (options?.branch) {
    args.splice(1, 0, "--branch", options.branch);
  }
  if (options?.depth) {
    args.splice(1, 0, "--depth", options.depth.toString());
  }

  await runCommand(ctx, "git", args, { cwd: workspaceRoot });
};

export const fetchRepo = async (
  ctx: JobContext,
  workspaceRoot: string,
  repoPath: string,
  remote = "origin",
  prune = false,
) => {
  const resolved = await resolveRepoPath(workspaceRoot, repoPath);

  const args = ["-C", resolved, "fetch", remote];
  if (prune) {
    args.push("--prune");
  }

  await runCommand(ctx, "git", args);
};

export const getRepoStatus = async (
  workspaceRoot: string,
  repoPath: string,
): Promise<GitStatus> => {
  const resolved = await resolveRepoPath(workspaceRoot, repoPath);

  const { execa } = await import("execa");
  const result = await execa("git", [
    "-C",
    resolved,
    "status",
    "--porcelain=2",
    "-b",
  ]);
  return parseStatus(result.stdout);
};

export const resolveRepoPath = async (
  workspaceRoot: string,
  repoPath: string,
) => {
  const resolved = await resolveInsideWorkspace(workspaceRoot, repoPath);
  await assertRepoExists(resolved);
  return resolved;
};

const assertRepoExists = async (repoPath: string) => {
  const stats = await fs.stat(repoPath);
  if (!stats.isDirectory()) {
    throw new RepoNotFoundError("Repository path is not a directory.");
  }
  const gitPath = path.join(repoPath, ".git");
  try {
    await fs.access(gitPath);
  } catch {
    throw new RepoNotFoundError("Repository .git directory not found.");
  }
};

const parseStatus = (output: string): GitStatus => {
  let branch = "";
  let ahead = 0;
  let behind = 0;
  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;
  let conflictsCount = 0;

  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("# branch.head")) {
      branch = line.split(" ").slice(2).join(" ").trim();
      continue;
    }
    if (line.startsWith("# branch.ab")) {
      const parts = line.split(" ");
      const aheadPart = parts.find((part) => part.startsWith("+"));
      const behindPart = parts.find((part) => part.startsWith("-"));
      ahead = aheadPart ? Number(aheadPart.slice(1)) : 0;
      behind = behindPart ? Number(behindPart.slice(1)) : 0;
      continue;
    }
    if (line.startsWith("?")) {
      untrackedCount += 1;
      continue;
    }
    if (line.startsWith("u")) {
      conflictsCount += 1;
      continue;
    }
    if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const x = line[2];
      const y = line[3];
      if (x && x !== ".") {
        stagedCount += 1;
      }
      if (y && y !== ".") {
        unstagedCount += 1;
      }
    }
  }

  const clean =
    stagedCount === 0 &&
    unstagedCount === 0 &&
    untrackedCount === 0 &&
    conflictsCount === 0;

  return {
    branch,
    ahead,
    behind,
    stagedCount,
    unstagedCount,
    untrackedCount,
    conflictsCount,
    clean,
  };
};
