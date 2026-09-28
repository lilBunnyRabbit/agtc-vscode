import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { run } from "../lib/shell";

const DIR = join(".agtc", "attachments");
const IGNORE = ".agtc/";

/**
 * Files for the agent go into the checkout, where its sandbox can read them. Kept out of git
 * through the repository's own exclude file, so no tracked file changes.
 */
export async function attach(checkout: string, files: string[], now = Date.now()): Promise<string[]> {
  if (!files.length) return [];
  const target = join(checkout, DIR);
  mkdirSync(target, { recursive: true });
  await exclude(checkout);
  return files.map((file, i) => {
    const copy = join(target, `${now}-${i + 1}-${basename(file)}`);
    copyFileSync(file, copy);
    return join(DIR, basename(copy));
  });
}

async function exclude(checkout: string): Promise<void> {
  const commonDir = await run(["git", "-C", checkout, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!commonDir) return;
  const file = join(commonDir, "info", "exclude");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current.split("\n").includes(IGNORE)) return;
  mkdirSync(join(commonDir, "info"), { recursive: true });
  appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}${IGNORE}\n`);
}

export function withAttachments(task: string, attached: string[]): string {
  if (!attached.length) return task;
  return `${task.trim()}\n\nAttached files, relative to the checkout:\n${attached.map((file) => `- ${file}`).join("\n")}\n`;
}
