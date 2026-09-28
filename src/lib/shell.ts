import { execFile, spawn } from "node:child_process";

const MAX_BUFFER = 64 * 1024 * 1024;

export function run(argv: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(argv[0], argv.slice(1), { encoding: "utf8", maxBuffer: MAX_BUFFER }, (_error, stdout) => resolve((stdout ?? "").trim()));
  });
}

export function exec(argv: string[], cwd?: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(argv[0], argv.slice(1), { encoding: "utf8", maxBuffer: MAX_BUFFER, cwd }, (error, stdout, stderr) =>
      resolve({ ok: !error, output: ((stdout ?? "") + (stderr ?? "")).trim() || (error ? String(error.message) : "") }),
    );
  });
}

export function succeeds(argv: string[]): Promise<boolean> {
  return new Promise((resolve) => execFile(argv[0], argv.slice(1), (error) => resolve(!error)));
}

export function launch(argv: string[], env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const child = spawn(argv[0], argv.slice(1), { env, stdio: "ignore", detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
