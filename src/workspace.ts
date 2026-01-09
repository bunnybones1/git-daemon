import path from "path";
import { promises as fs } from "fs";
import { pathOutsideWorkspace, workspaceRequired } from "./errors";

export class MissingPathError extends Error {}

const MAX_PATH_LENGTH = 4096;

export const ensureWorkspaceRoot = (root: string | null) => {
  if (!root) {
    throw workspaceRequired();
  }
  if (root.length > MAX_PATH_LENGTH) {
    throw pathOutsideWorkspace();
  }
  return root;
};

const realpathSafe = async (target: string) => {
  try {
    return await fs.realpath(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
};

export const resolveInsideWorkspace = async (
  workspaceRoot: string,
  candidate: string,
  allowMissing = false,
) => {
  if (candidate.length > MAX_PATH_LENGTH) {
    throw pathOutsideWorkspace();
  }

  const rootReal = await fs.realpath(workspaceRoot);
  const resolved = path.resolve(rootReal, candidate);

  if (!isInside(rootReal, resolved)) {
    throw pathOutsideWorkspace();
  }

  const realResolved = await realpathSafe(resolved);
  if (realResolved) {
    if (!isInside(rootReal, realResolved)) {
      throw pathOutsideWorkspace();
    }
    return realResolved;
  }

  if (!allowMissing) {
    throw new MissingPathError("Path does not exist.");
  }

  const parent = path.dirname(resolved);
  const parentReal = await realpathSafe(parent);
  if (parentReal && !isInside(rootReal, parentReal)) {
    throw pathOutsideWorkspace();
  }
  return resolved;
};

const isInside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  if (relative === "") {
    return true;
  }
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

export const ensureRelative = (target: string) => {
  if (path.isAbsolute(target)) {
    throw pathOutsideWorkspace();
  }
  const normalized = path.normalize(target);
  if (normalized === "." || normalized.startsWith("..")) {
    throw pathOutsideWorkspace();
  }
  return target;
};
