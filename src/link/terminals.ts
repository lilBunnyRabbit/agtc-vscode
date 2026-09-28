import { type Terminal, window } from "vscode";
import { run } from "../lib/shell";
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
  const surfaces: Surfaces = new Map();
  const byId = new Map<string, Terminal>();
  terminals.forEach((terminal, i) => {
    const pid = pidOf[i];
    const tty = pid ? ttyByPid.get(pid) : undefined;
    if (!tty) return;
    const id = terminalId(terminal);
    byId.set(id, terminal);
    surfaces.set(tty, { title: terminal.name, viewed: focused && window.activeTerminal === terminal, terminal: id });
  });
  return { surfaces, byId };
}
