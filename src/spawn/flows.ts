import { existsSync } from "node:fs";
import { window, workspace } from "vscode";
import { collapse, tildify, untildify } from "../lib/text";
import { type Session, type Tool, TOOLS, resumeInvocation, workDir } from "../model/session";
import { HOME } from "../paths";
import { baseBranch, checkoutName, createWorktree } from "../sources/git";
import { sendLine } from "../tmux/tmux";
import { attach, withAttachments } from "./attachments";
import { DEFAULT_WORKTREES_DIR, enterWorktreeRequest, startCommand, worktreeDir, writeTask } from "./task";

export interface SpawnContext {
  sessions: Session[];
  refresh(): Promise<void>;
  /** The new pane; undefined when the window restarts first and the agent starts after the restart, or when tmux failed. */
  launch(dir: string, command: string, name: string, beside?: string): Promise<string | undefined>;
  show(pane: string): Promise<boolean>;
}

const say = (text: string): void => void window.setStatusBarMessage(`agtc: ${text}`, 4000);

export async function startAgent(ctx: SpawnContext, tool: Tool, dir: string, taskPath?: string): Promise<void> {
  say(`starting ${tool} in ${tildify(dir, HOME)}`);
  await ctx.launch(dir, startCommand(tool, taskPath), await checkoutName(dir));
}

/** `n`: the session's tool in a checkout of its repo, the session's own first. */
export async function newAgent(ctx: SpawnContext, session?: Session): Promise<void> {
  const tool = session?.tool ?? (await pickTool());
  if (!tool) return;
  const dir = await pickCheckout(ctx, session, `new ${tool} in`);
  if (dir) await startAgent(ctx, tool, dir);
}

/** `N`: a fresh worktree of the session's repository, then an agent in it. */
export async function newWorktree(ctx: SpawnContext, session?: Session, taskPath?: string): Promise<void> {
  const tool = session?.tool ?? (await pickTool());
  if (!tool) return;
  const mainRoot = session?.mainRoot ?? (await pickCheckout(ctx, undefined, "worktree of"));
  if (!mainRoot) return;
  const branch = await askBranch();
  if (!branch) return;
  const dir = await createWorktreeFor(mainRoot, branch);
  if (dir) await startAgent(ctx, tool, dir, taskPath);
}

/**
 * `W`: a running session moves into a fresh worktree. Claude does it itself through
 * `EnterWorktree`; Codex has no such tool, so a new Codex starts in the worktree with the
 * session's last prompt and the old one stays.
 */
export async function moveToWorktree(ctx: SpawnContext, session: Session): Promise<void> {
  if (session.status === "inactive") return say("not running: R resumes it first");
  if (!session.mainRoot) return say("not a git checkout");
  if (session.worktree) return say(`already in worktree ${session.worktree}`);
  if (session.tool === "claude" && !session.pane) return say("runs outside tmux: bring it here first");
  const branch = await askBranch();
  if (!branch) return;
  if (session.tool === "claude" && session.pane) {
    await sendLine(session.pane, enterWorktreeRequest(branch));
    await ctx.show(session.pane);
    return;
  }
  const dir = await createWorktreeFor(session.mainRoot, branch);
  if (dir) await startAgent(ctx, "codex", dir, session.lastPrompt ? writeTask(session.lastPrompt) : undefined);
}

/** `R`: a finished session again, in the directory it stopped in. */
export async function resumeAgent(ctx: SpawnContext, session: Session): Promise<void> {
  if (session.status !== "inactive") return say("still running");
  const dir = session.cwd;
  if (!existsSync(dir)) return say(`directory is gone: ${tildify(dir, HOME)}`);
  say(`resuming ${session.tool} in ${tildify(dir, HOME)}`);
  await ctx.launch(dir, resumeInvocation(session), await checkoutName(dir));
}

/** `⌘⌥T`: tool, checkout, worktree or not, task. */
export async function compose(ctx: SpawnContext): Promise<void> {
  const tool = await pickTool();
  if (!tool) return;
  const dir = await pickCheckout(ctx, undefined, `new ${tool} in`);
  if (!dir) return;
  const where = await window.showQuickPick(["this checkout", "new worktree"], { placeHolder: "where does it work" });
  if (!where) return;
  const task = await window.showInputBox({ prompt: "task (empty starts the agent without one)", ignoreFocusOut: true });
  if (task === undefined) return;
  const taskPath = task.trim() ? writeTask(task) : undefined;
  if (where === "this checkout") return startAgent(ctx, tool, dir, taskPath);
  const branch = await askBranch();
  if (!branch) return;
  const mainRoot = ctx.sessions.find((s) => workDir(s) === dir)?.mainRoot ?? dir;
  const worktree = await createWorktreeFor(mainRoot, branch);
  if (worktree) await startAgent(ctx, tool, worktree, taskPath);
}

async function pickTool(): Promise<Tool | undefined> {
  return (await window.showQuickPick(TOOLS, { placeHolder: "which agent" })) as Tool | undefined;
}

function askBranch(): Thenable<string | undefined> {
  return window.showInputBox({ prompt: "branch for the new worktree", validateInput: (v) => (/^[\w./+-]+$/.test(v.trim()) ? undefined : "letters, digits, . / _ + -") }).then((v) => v?.trim() || undefined);
}

/** The session's own checkout, the open folders, then every checkout seen, the session's repo first. */
export function knownCheckouts(sessions: Session[], session?: Session): string[] {
  const dirs = new Set<string>();
  if (session) dirs.add(workDir(session));
  for (const folder of workspace.workspaceFolders ?? []) dirs.add(folder.uri.fsPath);
  const sameRepoFirst = [...sessions].sort((a, b) => Number(b.repo === (session?.repo ?? "")) - Number(a.repo === (session?.repo ?? "")));
  for (const s of sameRepoFirst) {
    if (s.mainRoot) dirs.add(s.mainRoot);
    dirs.add(workDir(s));
  }
  return [...dirs].filter((dir) => existsSync(dir));
}

export interface ComposerInput {
  tool: Tool;
  dir: string;
  branch?: string;
  task: string;
  attachments?: string[];
}

export async function attachFiles(): Promise<string[]> {
  const uris = await window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: true, openLabel: "Attach" });
  return (uris ?? []).map((uri) => uri.fsPath);
}

/** The home page composer: a task in a checkout, or in a new worktree of it. */
export async function startFromComposer(ctx: SpawnContext, { tool, dir, branch, task, attachments = [] }: ComposerInput): Promise<void> {
  if (!existsSync(dir)) return say(`no such directory: ${tildify(dir, HOME)}`);
  const mainRoot = ctx.sessions.find((s) => workDir(s) === dir)?.mainRoot ?? dir;
  const target = branch ? await createWorktreeFor(mainRoot, branch) : dir;
  if (!target) return;
  const text = withAttachments(task, await attach(target, attachments.filter((file) => existsSync(file))));
  await startAgent(ctx, tool, target, text.trim() ? writeTask(text) : undefined);
}

async function pickCheckout(ctx: SpawnContext, session: Session | undefined, placeHolder: string): Promise<string | undefined> {
  const known = knownCheckouts(ctx.sessions, session).map((dir) => tildify(dir, HOME));
  const OTHER = "other…";
  const picked = await window.showQuickPick([...known, OTHER], { placeHolder });
  if (!picked) return undefined;
  const value = picked === OTHER ? await window.showInputBox({ prompt: "directory", value: known[0] }) : picked;
  if (!value) return undefined;
  const dir = untildify(value.trim(), HOME);
  if (!existsSync(dir)) {
    say(`no such directory: ${tildify(dir, HOME)}`);
    return undefined;
  }
  return dir;
}

async function createWorktreeFor(mainRoot: string, branch: string): Promise<string | undefined> {
  const config = workspace.getConfiguration("agtc");
  const dir = worktreeDir(mainRoot, branch, config.get<string>("worktreeDir") || DEFAULT_WORKTREES_DIR);
  if (existsSync(dir)) {
    say(`already exists: ${tildify(dir, HOME)}`);
    return undefined;
  }
  const base = config.get<string>("baseBranch") || (await baseBranch(mainRoot)) || "HEAD";
  say(`creating ${tildify(dir, HOME)} from ${base}…`);
  const error = await createWorktree(mainRoot, { dir, branch, base });
  if (error) {
    void window.showErrorMessage(`git: ${collapse(error, 200)}`);
    return undefined;
  }
  return dir;
}
