import { execa } from "execa";

export const openTarget = async (
  target: "folder" | "terminal" | "vscode",
  resolvedPath: string,
) => {
  const platform = process.platform;

  if (target === "folder") {
    if (platform === "darwin") {
      await execa("open", [resolvedPath]);
      return;
    }
    if (platform === "win32") {
      await execa("cmd", ["/c", "start", "", resolvedPath]);
      return;
    }
    await execa("xdg-open", [resolvedPath]);
    return;
  }

  if (target === "terminal") {
    if (platform === "darwin") {
      await execa("open", ["-a", "Terminal", resolvedPath]);
      return;
    }
    if (platform === "win32") {
      await execa("cmd", [
        "/c",
        "start",
        "",
        "cmd.exe",
        "/k",
        "cd",
        "/d",
        resolvedPath,
      ]);
      return;
    }
    await execa("x-terminal-emulator", ["--working-directory", resolvedPath]);
    return;
  }

  await execa("code", [resolvedPath]);
};
