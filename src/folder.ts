import { basename } from "node:path";
import { Uri, workspace } from "vscode";

export const currentFolder = (): string => workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

const OURS = "agtc · ";

/**
 * The session's checkout as a root of its own, after the window's first folder, replaced on every
 * switch. The first folder never changes: changing it restarts every extension, and the Claude
 * Code extension then takes a new port, which cuts every running agent off from the editor.
 * Only going from one folder to two restarts, once per window; `willRestart` runs before that.
 */
export async function openFolderHere(dir: string, willRestart: () => Thenable<void>): Promise<boolean> {
  const folders = workspace.workspaceFolders ?? [];
  if (folders.some((folder) => folder.uri.fsPath === dir && !folder.name.startsWith(OURS))) return false;
  const ours = folders.findIndex((folder) => folder.name.startsWith(OURS));
  if (ours >= 0 && folders[ours].uri.fsPath === dir) return false;
  const entry = { uri: Uri.file(dir), name: `${OURS}${basename(dir)}` };
  if (folders.length < 2) await willRestart();
  return ours >= 0 ? workspace.updateWorkspaceFolders(ours, 1, entry) : workspace.updateWorkspaceFolders(folders.length, 0, entry);
}
