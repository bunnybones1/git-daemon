import path from "path";
import type { AppConfig, Capability } from "./types";
import { capabilityNotGranted } from "./errors";

export const hasApproval = (
  config: AppConfig,
  origin: string,
  repoPath: string,
  capability: Capability,
  workspaceRoot?: string | null,
) =>
  config.approvals.entries.some((entry) => {
    if (entry.origin !== origin || !entry.capabilities.includes(capability)) {
      return false;
    }
    if (entry.repoPath === repoPath) {
      return true;
    }
    if (workspaceRoot && !path.isAbsolute(entry.repoPath)) {
      return path.resolve(workspaceRoot, entry.repoPath) === repoPath;
    }
    return false;
  });

export const requireApproval = (
  config: AppConfig,
  origin: string,
  repoPath: string,
  capability: Capability,
  workspaceRoot?: string | null,
) => {
  if (!hasApproval(config, origin, repoPath, capability, workspaceRoot)) {
    throw capabilityNotGranted();
  }
};
