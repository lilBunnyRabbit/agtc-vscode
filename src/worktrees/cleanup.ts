import { type OutputChannel, type QuickPickItem, window, workspace } from "vscode";
import { plural, tildify } from "../lib/text";
import { relativeAge } from "../lib/time";
import type { Session } from "../model/session";
import { HOME } from "../paths";
import { readWorktrees } from "./read";
import { removeAll } from "./remove";
import { type Worktree, canRemove, isRemovable } from "./state";

interface Item extends QuickPickItem {
  worktree: Worktree;
}

export function factsOf({ state, dirty, ahead, upstream, heldBy }: Worktree): string {
  const facts: string[] = [state];
  if (dirty) facts.push(plural(dirty, "changed file", "changed files"));
  if (ahead > 0) facts.push(`ahead ${ahead}${upstream ? "" : ", never pushed"}`);
  if (heldBy) facts.push(`also in ${heldBy}`);
  return facts.join(" · ");
}

/** The repository's worktrees with their state, the safely removable ones ticked; nothing goes without the confirm. */
export async function cleanWorktrees(sessions: Session[], output: OutputChannel, selected?: Session): Promise<boolean> {
  const mainRoot = selected?.mainRoot ?? (await pickRepo(sessions));
  if (!mainRoot) return false;
  const report = await window.withProgress({ location: { viewId: "agtc.sessions" }, title: "reading worktrees" }, () => readWorktrees(mainRoot, sessions));
  if (!report) {
    void window.showWarningMessage(`${tildify(mainRoot, HOME)} is not a git checkout`);
    return false;
  }
  const candidates = report.worktrees.filter(canRemove);
  if (!candidates.length) {
    void window.showInformationMessage(`${report.repo}: no worktrees to clean up${report.worktrees.length ? `, ${plural(report.worktrees.length, "one is", "are")} live or locked` : ""}`);
    return false;
  }
  const items: Item[] = candidates.map((worktree) => ({
    label: worktree.name,
    description: worktree.branch ?? "detached",
    detail: `${factsOf(worktree)} · active ${relativeAge(worktree.activeAt)} ago${worktree.session ? ` · ${worktree.session.title}` : ""}`,
    picked: isRemovable(worktree),
    worktree,
  }));
  const picked = await window.showQuickPick(items, { canPickMany: true, matchOnDescription: true, matchOnDetail: true, placeHolder: `${report.repo}: worktrees to remove, the safe ones are ticked` });
  if (!picked?.length) return false;
  const doomed = picked.map((item) => item.worktree);
  const risky = doomed.filter((w) => !isRemovable(w));
  const warning = risky.length ? `${plural(risky.length, "worktree has", "worktrees have")} work that exists nowhere else (${risky.map((w) => `${w.name}: ${factsOf(w)}`).join("; ")}). Removing discards it.` : "Branches gone from the remote or never committed to are deleted with their worktree.";
  const confirm = `Remove ${plural(doomed.length, "worktree", "worktrees")}`;
  if ((await window.showWarningMessage(`Remove ${plural(doomed.length, "worktree", "worktrees")} of ${report.repo}?`, { modal: true, detail: warning }, confirm)) !== confirm) return false;
  const outcomes = await window.withProgress({ location: { viewId: "agtc.sessions" }, title: "removing worktrees" }, () => removeAll(report, doomed));
  for (const outcome of outcomes) output.appendLine(outcome.line);
  const failed = outcomes.filter((o) => o.error).length;
  if (failed) {
    output.show(true);
    void window.showErrorMessage(`${plural(failed, "worktree", "worktrees")} could not be removed, see the agtc output`);
  } else window.setStatusBarMessage(`agtc: removed ${plural(outcomes.length, "worktree", "worktrees")}`, 5000);
  return true;
}

async function pickRepo(sessions: Session[]): Promise<string | undefined> {
  const roots = new Set<string>();
  for (const session of sessions) if (session.mainRoot) roots.add(session.mainRoot);
  for (const folder of workspace.workspaceFolders ?? []) roots.add(folder.uri.fsPath);
  if (roots.size <= 1) return [...roots][0];
  const picked = await window.showQuickPick([...roots].map((root) => tildify(root, HOME)), { placeHolder: "clean up worktrees of" });
  return picked ? [...roots].find((root) => tildify(root, HOME) === picked) : undefined;
}
