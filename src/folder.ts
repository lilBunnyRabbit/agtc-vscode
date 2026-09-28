import { Uri, workspace } from "vscode";

/**
 * Replacing the first workspace folder restarts the extension host, terminals included in the
 * window survive it. Accepted: the poll rebuilds everything from disk on the next start.
 */
export function openFolderHere(dir: string): boolean {
  const uri = Uri.file(dir);
  const folders = workspace.workspaceFolders ?? [];
  if (folders.length === 1 && folders[0].uri.fsPath === uri.fsPath) return false;
  return workspace.updateWorkspaceFolders(0, folders.length, { uri });
}

export function isOpenFolder(dir: string): boolean {
  return (workspace.workspaceFolders ?? []).some((folder) => folder.uri.fsPath === dir);
}
