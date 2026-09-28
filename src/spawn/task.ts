import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { shellQuote } from "../lib/shell";
import type { Tool } from "../model/tools";
import { PROMPTS_DIR } from "../paths";

/** A long task does not survive a shell line, so the agent reads it from a file. */
export function writeTask(text: string, now = Date.now()): string {
  mkdirSync(PROMPTS_DIR, { recursive: true });
  const path = join(PROMPTS_DIR, `task-${now}.md`);
  writeFileSync(path, text.trim() + "\n");
  return path;
}

export function startCommand(tool: Tool, taskPath?: string): string {
  return taskPath ? `${tool} "$(cat ${shellQuote(taskPath)})"` : tool;
}

export const DEFAULT_WORKTREES_DIR = join(".claude", "worktrees");

/** A directory name swaps "/" for "+", like Claude Code does. */
export function worktreeDir(mainRoot: string, branch: string, configured = DEFAULT_WORKTREES_DIR): string {
  const base = isAbsolute(configured) ? configured : join(mainRoot, configured);
  return join(base, branch.replace(/\//g, "+"));
}

export function enterWorktreeRequest(branch: string): string {
  return `Move this session into a new git worktree on a branch named ${branch} with the EnterWorktree tool, then continue the current task there.`;
}
