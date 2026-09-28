import { basename } from "node:path";
import { feed, run, succeeds } from "../lib/shell";
import { HOME } from "../paths";
import type { Surfaces } from "../sources/types";

/** The hub's session: agents started here and in the hub are the same windows. */
export const AGENTS_SESSION = "agtc";

const SEP = "\t";
const PANE_FORMAT = ["#{pane_tty}", "#{pane_id}", "#{session_name}", "#{window_active}", "#{pane_title}"].join(SEP);
const CLIENT_FORMAT = ["#{client_tty}", "#{client_session}"].join(SEP);

export const tmux = (...args: string[]) => run(["tmux", ...args]);
const ok = (...args: string[]) => succeeds(["tmux", ...args]);
const ttyName = (path: string) => path.replace("/dev/", "");

export const hasSession = (name: string) => ok("has-session", "-t", `=${name}`);

/** Claude Code drops to 256 colours under tmux unless CLAUDE_CODE_TMUX_TRUECOLOR says otherwise. */
export async function ensureAgentsSession(): Promise<boolean> {
  if (!(await hasSession(AGENTS_SESSION)) && !(await ok("new-session", "-d", "-s", AGENTS_SESSION, "-n", "shell", "-c", HOME))) return false;
  await ok("set-environment", "-t", `=${AGENTS_SESSION}:`, "CLAUDE_CODE_TMUX_TRUECOLOR", "1");
  return true;
}

/**
 * Every pane by tty. Sessions of one group list the same panes once each, so a pane is viewed
 * when its window is the current one in any session a watching client shows. `watching` says
 * per client tty whether someone looks at it; a client not named there always counts.
 */
export async function tmuxPanes(watching: Map<string, boolean>): Promise<Surfaces> {
  const panes: Surfaces = new Map();
  const watched = new Set<string>();
  for (const line of (await tmux("list-clients", "-F", CLIENT_FORMAT)).split("\n")) {
    const [ttyPath, session] = line.split(SEP);
    if (ttyPath && (watching.get(ttyName(ttyPath)) ?? true)) watched.add(session);
  }
  for (const line of (await tmux("list-panes", "-a", "-F", PANE_FORMAT)).split("\n")) {
    const [ttyPath, pane, session, windowActive, ...title] = line.split(SEP);
    if (!ttyPath) continue;
    const viewed = windowActive === "1" && watched.has(session);
    const known = panes.get(ttyName(ttyPath));
    if (known) known.viewed ||= viewed;
    else panes.set(ttyName(ttyPath), { title: title.join(SEP), viewed, pane });
  }
  return panes;
}

/** Through a shell in the window, so the window outlives the agent and shows why it quit. */
export async function newWindow(cwd: string, command: string, name = basename(cwd)): Promise<string | undefined> {
  if (!(await ensureAgentsSession())) return undefined;
  const pane = await tmux("new-window", "-d", "-P", "-F", "#{pane_id}", "-c", cwd, "-n", name, "-t", `${AGENTS_SESSION}:`);
  if (!pane) return undefined;
  await ok("send-keys", "-t", pane, command, "Enter");
  return pane;
}

export async function splitPane(beside: string, cwd: string, command: string): Promise<string | undefined> {
  const pane = await tmux("split-window", "-d", "-h", "-P", "-F", "#{pane_id}", "-c", cwd, "-t", beside);
  if (!pane) return undefined;
  await ok("send-keys", "-t", pane, command, "Enter");
  return pane;
}

export const killPane = (pane: string) => ok("kill-pane", "-t", pane);

/** Bracketed paste, so newlines do not submit. */
export async function pasteIntoPane(pane: string, text: string): Promise<boolean> {
  const buffer = `agtc-vs-${process.pid}`;
  return (await feed(["tmux", "load-buffer", "-b", buffer, "-"], text.trimEnd())) && ok("paste-buffer", "-p", "-d", "-b", buffer, "-t", pane);
}

export async function sendLine(pane: string, text: string): Promise<boolean> {
  return (await ok("send-keys", "-t", pane, "-l", text)) && ok("send-keys", "-t", pane, "Enter");
}

export interface PanePlace {
  session: string;
  windowId: string;
  group: string;
}

export async function placeOf(pane: string): Promise<PanePlace | undefined> {
  const [session, windowId, group] = (await tmux("display", "-p", "-t", pane, ["#{session_name}", "#{window_id}", "#{session_group}"].join(SEP))).split(SEP);
  return session && windowId ? { session, windowId, group: group ?? "" } : undefined;
}
