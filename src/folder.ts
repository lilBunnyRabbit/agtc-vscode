import { Uri, workspace } from "vscode";

export const currentFolder = (): string => workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

/**
 * Replacing the first workspace folder restarts the extension host, terminals included in the
 * window survive it. Accepted: the poll rebuilds everything from disk on the next start.
 */
export async function openFolderHere(dir: string, before: (from: string, to: string) => Thenable<void>): Promise<boolean> {
  const uri = Uri.file(dir);
  const folders = workspace.workspaceFolders ?? [];
  if (folders.length === 1 && folders[0].uri.fsPath === uri.fsPath) return false;
  await before(currentFolder(), uri.fsPath);
  return workspace.updateWorkspaceFolders(0, folders.length, { uri });
}
