import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Uri, workspace } from "vscode";
import { WINDOWS_DIR } from "./paths";

export const currentFolder = (): string => workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

const isPin = (dir: string) => dirname(dir) === WINDOWS_DIR;

/**
 * The window holds an empty placeholder as its first folder and the session's checkout as its
 * second, so quick open, search, Explorer and source control see that checkout alone. Changing
 * the first folder restarts every extension, and the Claude Code extension then takes a new
 * port, which cuts every running agent off from the editor; replacing the second does not.
 * The placeholder is a directory of its own per window, which also tells windows apart after a
 * restart. Putting it in restarts once; `willRestart` runs before that.
 */
export async function openFolderHere(dir: string, willRestart: (from: string, to: string) => Thenable<void>): Promise<boolean> {
  const folders = workspace.workspaceFolders ?? [];
  const entry = { uri: Uri.file(dir), name: basename(dir) };
  if (folders.length && isPin(folders[0].uri.fsPath)) {
    if (folders.length === 2 && folders[1].uri.fsPath === dir) return false;
    return workspace.updateWorkspaceFolders(1, folders.length - 1, entry);
  }
  const pin = join(WINDOWS_DIR, randomUUID().slice(0, 8));
  mkdirSync(pin, { recursive: true });
  await willRestart(currentFolder(), pin);
  return workspace.updateWorkspaceFolders(0, folders.length, { uri: Uri.file(pin), name: "agtc" }, entry);
}
