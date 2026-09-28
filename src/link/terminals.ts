import { type Terminal, window } from "vscode";
import { exec, run } from "../lib/shell";
import type { Surfaces } from "../sources/types";

export interface LinkedTerminals {
  surfaces: Surfaces;
  byId: Map<string, Terminal>;
}

const ids = new WeakMap<Terminal, string>();
const pids = new WeakMap<Terminal, Thenable<number | undefined>>();
const ttyByPid = new Map<number, string>();
let counter = 0;

export function terminalId(terminal: Terminal): string {
  let id = ids.get(terminal);
  if (!id) {
    id = `t${++counter}`;
    ids.set(terminal, id);
  }
  return id;
}

/** The shell and the agent it runs share one pty, so the tty from `ps` is the link between a terminal and a session. */
export async function linkedTerminals(): Promise<LinkedTerminals> {
  const terminals = window.terminals;
  const pidOf = await Promise.all(
    terminals.map((terminal) => {
      let pid = pids.get(terminal);
      if (!pid) {
        pid = terminal.processId;
        pids.set(terminal, pid);
      }
      return pid;
    }),
  );
  const unknown = pidOf.filter((pid): pid is number => !!pid && !ttyByPid.has(pid));
  if (unknown.length) {
    for (const line of (await run(["ps", "-o", "pid=,tty=", "-p", unknown.join(",")])).split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(\S+)/);
      if (match && match[2] !== "??") ttyByPid.set(Number(match[1]), match[2]);
    }
  }
  const focused = window.state.focused;
  const surfaces: Surfaces = await tmuxTitles();
  const byId = new Map<string, Terminal>();
  terminals.forEach((terminal, i) => {
    const pid = pidOf[i];
    const tty = pid ? ttyByPid.get(pid) : undefined;
    if (!tty) return;
    const id = terminalId(terminal);
    byId.set(id, terminal);
    surfaces.set(tty, { title: agentTitle(terminal), viewed: focused && window.activeTerminal === terminal, terminal: id });
  });
  return { surfaces, byId };
}

/** `name` follows the title the agent sets; until then it is the name the terminal was created with, which says nothing about the session. */
function agentTitle(terminal: Terminal): string {
  const created = "name" in terminal.creationOptions ? terminal.creationOptions.name : undefined;
  return terminal.name === created ? "" : terminal.name;
}

/** Sessions in tmux elsewhere still name themselves through the pane title; read for the name only, never as a terminal of ours. */
async function tmuxTitles(): Promise<Surfaces> {
  const surfaces: Surfaces = new Map();
  const { ok, output } = await exec(["tmux", "list-panes", "-a", "-F", "#{pane_tty}\t#{pane_title}"]);
  if (!ok) return surfaces;
  for (const line of output.split("\n")) {
    const [tty, ...title] = line.split("\t");
    if (tty) surfaces.set(tty.replace(/^\/dev\//, ""), { title: title.join("\t"), viewed: false });
  }
  return surfaces;
}
