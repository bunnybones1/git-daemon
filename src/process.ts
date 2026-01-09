import { execa, type Options as ExecaOptions } from "execa";
import treeKill from "tree-kill";
import type { JobContext } from "./jobs";

const attachLineReader = (
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
) => {
  if (!stream) {
    return;
  }
  let buffer = "";
  stream.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        onLine(line);
      }
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      onLine(buffer);
    }
  });
};

export const runCommand = async (
  ctx: JobContext,
  command: string,
  args: string[],
  options?: ExecaOptions,
) => {
  const subprocess = execa(command, args, {
    ...options,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (subprocess.pid) {
    ctx.setCancel(
      () =>
        new Promise<void>((resolve) => {
          treeKill(subprocess.pid, "SIGTERM", () => resolve());
        }),
    );
  }

  attachLineReader(subprocess.stdout, ctx.logStdout);
  attachLineReader(subprocess.stderr, ctx.logStderr);

  await subprocess;
};
