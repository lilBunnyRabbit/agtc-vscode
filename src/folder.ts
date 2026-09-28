import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { Uri, workspace } from "vscode";
import { CLAUDE_DIR, WINDOWS_DIR } from "./paths";

export const currentFolder = (): string => workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

const isPin = (dir: string) => dirname(dir) === WINDOWS_DIR;
const inside = (dir: string, root: string) => dir === root || dir.startsWith(root + sep);

export type Switch = "same" | "switched" | "restarting";

/** Whether the switch to `dir` needs the placeholder put in first, which restarts the extension host. */
export function needsPin(): boolean {
  const first = workspace.workspaceFolders?.[0];
  return !first || !isPin(first.uri.fsPath);
}

/**
 * The window holds an empty placeholder as its first folder and the session's checkout as its
 * second, so quick open, search, Explorer and source control see that checkout alone. Changing
 * the first folder restarts every extension, and the Claude Code extension then takes a new
 * port, which cuts every running agent off from the editor; replacing the second does not.
 * The placeholder is a directory of its own per window, which also tells windows apart after a
 * restart. Putting it in restarts once; `willRestart` runs before that.
 */
export async function openFolderHere(dir: string, willRestart: (from: string, to: string) => Thenable<void>): Promise<Switch> {
  const folders = workspace.workspaceFolders ?? [];
  const entry = { uri: Uri.file(dir), name: basename(dir) };
  if (!needsPin()) {
    if (folders.length === 2 && folders[1].uri.fsPath === dir) return "same";
    const changed = new Promise<void>((resolve) => {
      const listener = workspace.onDidChangeWorkspaceFolders(() => {
        listener.dispose();
        resolve();
      });
      setTimeout(resolve, SWITCH_TIMEOUT_MS);
    });
    if (!workspace.updateWorkspaceFolders(1, folders.length - 1, entry)) return "same";
    await changed;
    return "switched";
  }
  const pin = join(WINDOWS_DIR, randomUUID().slice(0, 8));
  mkdirSync(pin, { recursive: true });
  await willRestart(currentFolder(), pin);
  workspace.updateWorkspaceFolders(0, folders.length, { uri: Uri.file(pin), name: "agtc" }, entry);
  return "restarting";
}

const SWITCH_TIMEOUT_MS = 3000;
const IDE_TIMEOUT_MS = 4000;
const IDE_POLL_MS = 150;
const IDE_DIR = join(CLAUDE_DIR, "ide");

/**
 * Claude connects to the editor whose folders contain its directory, read once at start from
 * the lock files the Claude Code extension writes. An agent started before the lock names its
 * checkout comes up without the editor, so a launch waits for it. No extension, no lock: the
 * wait runs out and the agent starts anyway.
 */
export async function editorKnows(dir: string): Promise<boolean> {
  for (let waited = 0; waited < IDE_TIMEOUT_MS; waited += IDE_POLL_MS) {
    if (locks().some((folders) => folders.some((folder) => inside(dir, folder)))) return true;
    await new Promise((resolve) => setTimeout(resolve, IDE_POLL_MS));
  }
  return false;
}

function locks(): string[][] {
  try {
    return readdirSync(IDE_DIR)
      .filter((file) => file.endsWith(".lock"))
      .map((file) => {
        try {
          return (JSON.parse(readFileSync(join(IDE_DIR, file), "utf8")) as { workspaceFolders?: string[] }).workspaceFolders ?? [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
