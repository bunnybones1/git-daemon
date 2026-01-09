import { execa } from "execa";
import type { ToolInfo, Capabilities } from "./types";

const detect = async (
  command: string,
  args: string[] = ["--version"],
): Promise<ToolInfo> => {
  try {
    const result = await execa(command, args);
    const version = result.stdout.trim();
    return { installed: true, version };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { installed: false };
    }
    return { installed: false };
  }
};

export const detectCapabilities = async (): Promise<Capabilities> => {
  const [git, node, npm, pnpm, yarn, code] = await Promise.all([
    detect("git", ["--version"]),
    detect("node", ["--version"]),
    detect("npm", ["--version"]),
    detect("pnpm", ["--version"]),
    detect("yarn", ["--version"]),
    detect("code", ["--version"]),
  ]);

  return {
    tools: {
      git,
      node,
      npm,
      pnpm,
      yarn,
      code,
    },
  };
};

export const isToolInstalled = async (command: string) => {
  const info = await detect(command, ["--version"]);
  return info.installed;
};
