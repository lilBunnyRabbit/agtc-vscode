import { randomUUID } from "node:crypto";
import { type Terminal, TerminalLocation, window, workspace } from "vscode";
import { run } from "../lib/shell";
import { AGENTS_SESSION, ensureAgentsSession, hasSession, placeOf, tmux } from "./tmux";

const VIEWER_ENV = "AGTC_VIEWER";
const READY_TIMEOUT_MS = 4000;
const READY_POLL_MS = 100;

/**
 * The window's one terminal: a tmux client on a session of its own, grouped with the agents'
 * session. Grouped sessions share their windows and keep a current window each, so this window
 * can look at one agent while the hub or another window looks at another. Agents live in tmux,
 * not in this terminal: closing it, or the editor, ends nothing.
 */
export class Viewer {
  private tmuxPath: string | undefined;

  terminal(): Terminal | undefined {
    return window.terminals.find((terminal) => this.sessionOf(terminal) && terminal.exitStatus === undefined);
  }

  private sessionOf(terminal: Terminal): string | undefined {
    const options = terminal.creationOptions;
    return "env" in options ? (options.env?.[VIEWER_ENV] ?? undefined) : undefined;
  }

  async clientTty(): Promise<string | undefined> {
    const pid = await this.terminal()?.processId;
    if (!pid) return undefined;
    const tty = (await run(["ps", "-o", "tty=", "-p", String(pid)])).trim();
    return tty && tty !== "??" ? tty : undefined;
  }

  get active(): boolean {
    return window.state.focused && !!window.activeTerminal && window.activeTerminal === this.terminal();
  }

  async show(pane: string, preserveFocus = false): Promise<boolean> {
    const place = await placeOf(pane);
    if (!place) return false;
    const terminal = await this.ensure();
    if (!terminal) return false;
    const session = this.sessionOf(terminal)!;
    const shared = place.session === AGENTS_SESSION || place.group === AGENTS_SESSION;
    const tty = await this.clientTty();
    if (shared) {
      if (tty) await tmux("switch-client", "-c", `/dev/${tty}`, "-t", `=${session}:`);
      await tmux("select-window", "-t", `=${session}:${place.windowId}`);
    } else if (tty) await tmux("switch-client", "-c", `/dev/${tty}`, "-t", pane);
    await tmux("select-pane", "-t", pane);
    terminal.show(preserveFocus);
    return true;
  }

  private async ensure(): Promise<Terminal | undefined> {
    const existing = this.terminal();
    if (existing) return existing;
    this.tmuxPath ??= (await run(["which", "tmux"])) || undefined;
    if (!this.tmuxPath) {
      void window.showErrorMessage("agtc: tmux not found. Install it with: brew install tmux");
      return undefined;
    }
    if (!(await ensureAgentsSession())) return undefined;
    const session = `agtc-vs-${randomUUID().slice(0, 6)}`;
    const editor = workspace.getConfiguration("agtc").get<string>("terminalLocation", "panel") === "editor";
    const terminal = window.createTerminal({
      name: "agents",
      shellPath: this.tmuxPath,
      shellArgs: ["new-session", "-A", "-s", session, "-t", AGENTS_SESSION],
      // A window opened from the hub carries the hub's tmux variables; tmux refuses to nest with them set.
      env: { [VIEWER_ENV]: session, TMUX: null, TMUX_PANE: null, NODE_OPTIONS: null, VSCODE_INSPECTOR_OPTIONS: null },
      location: editor ? TerminalLocation.Editor : TerminalLocation.Panel,
      isTransient: true,
    });
    for (let waited = 0; waited < READY_TIMEOUT_MS && !(await hasSession(session)); waited += READY_POLL_MS) await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    return terminal;
  }

  /** A closed viewer leaves its session behind; the windows stay, they belong to the group. */
  async sweep(): Promise<void> {
    const live = new Set(window.terminals.map((terminal) => this.sessionOf(terminal)).filter(Boolean));
    const clients = new Set((await tmux("list-clients", "-F", "#{client_session}")).split("\n"));
    for (const name of (await tmux("list-sessions", "-F", "#{session_name}")).split("\n")) {
      if (name.startsWith("agtc-vs-") && !live.has(name) && !clients.has(name)) await tmux("kill-session", "-t", `=${name}`);
    }
  }
}
