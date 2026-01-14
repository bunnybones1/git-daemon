import { z } from "zod";

const MAX_PATH_LENGTH = 4096;

const isValidRepoUrl = (value: string) => {
  if (value.startsWith("file://")) {
    return false;
  }
  if (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../")
  ) {
    return false;
  }
  if (/^git@[^:]+:.+/.test(value)) {
    return true;
  }
  if (/^https:\/\/[^/]+\/.+/.test(value)) {
    return true;
  }
  if (/^ssh:\/\/[^/]+\/.+/.test(value)) {
    return true;
  }
  return false;
};

export const pairRequestSchema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("start"),
  }),
  z.object({
    step: z.literal("confirm"),
    code: z.string().min(1),
  }),
]);

export const gitCloneRequestSchema = z.object({
  repoUrl: z.string().min(1).refine(isValidRepoUrl),
  destRelative: z.string().min(1).max(MAX_PATH_LENGTH),
  options: z
    .object({
      branch: z.string().min(1).optional(),
      depth: z.number().int().min(1).optional(),
    })
    .optional(),
});

export const gitFetchRequestSchema = z.object({
  repoPath: z.string().min(1).max(MAX_PATH_LENGTH),
  remote: z.string().min(1).optional(),
  prune: z.boolean().optional(),
});

export const gitStatusQuerySchema = z.object({
  repoPath: z.string().min(1).max(MAX_PATH_LENGTH),
});

export const gitSummaryQuerySchema = z.object({
  repoPath: z.string().min(1).max(MAX_PATH_LENGTH),
});

export const gitBranchesQuerySchema = z.object({
  repoPath: z.string().min(1).max(MAX_PATH_LENGTH),
  includeRemote: z.enum(["true", "false"]).optional(),
});

export const osOpenRequestSchema = z.object({
  target: z.enum(["folder", "terminal", "vscode"]),
  path: z.string().min(1).max(MAX_PATH_LENGTH),
});

export const depsInstallRequestSchema = z.object({
  repoPath: z.string().min(1).max(MAX_PATH_LENGTH),
  manager: z.enum(["auto", "npm", "pnpm", "yarn"]).optional(),
  mode: z.enum(["auto", "ci", "install"]).optional(),
  safer: z.boolean().optional(),
});
