import { type OutputChannel, StatusBarAlignment, type Terminal, Uri, commands, window, workspace } from "vscode";
import { openFolderHere } from "./folder";
import { SECOND } from "./lib/time";
import { linkedTerminals } from "./link/terminals";
import { type Session, STATUS_PRIORITY, workDir } from "./model/session";
import { collectSessions } from "./model/sessions";
import { StateStore } from "./model/state-store";
import { STATE_FILE } from "./paths";
import { buildDetail, buildGroups } from "./views/model";
import { SessionsPanel } from "./views/panel";

const POLL_VISIBLE_MS = 2 * SECOND;
const POLL_HIDDEN_MS = 10 * SECOND;

export class App {
  readonly state = StateStore.load(STATE_FILE);
  readonly panel: SessionsPanel;
  private readonly status = window.createStatusBarItem(StatusBarAlignment.Left, 50);
  private terminals = new Map<string, Terminal>();
  private list: Session[] = [];
  private selectedId: string | undefined;
  private showInactive = false;
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(
    private readonly output: OutputChannel,
    extensionUri: Uri,
  ) {
    this.panel = new SessionsPanel(extensionUri);
    this.status.command = "agtc.jumpWaiting";
    this.panel.onDidChangeVisibility(() => this.schedule());
    this.panel.onMessage((message) => {
      switch (message.type) {
        case "select":
          return this.select(message.id, false);
        case "jump": {
          const session = this.byId(message.id);
          return session && void this.jump(session);
        }
        case "openFile":
          return void commands.executeCommand("agtc.openDiff", message.file);
        case "command":
          return void commands.executeCommand(message.command, message.id);
      }
    });
    window.onDidChangeActiveTerminal((terminal) => {
      const session = terminal && this.sessionInTerminal(terminal);
      if (session) this.select(session.id, true);
    });
    void this.refresh().then(() => this.schedule());
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.status.dispose();
  }

  get selected(): Session | undefined {
    return this.selectedId ? this.byId(this.selectedId) : undefined;
  }

  byId(id: string): Session | undefined {
    return this.list.find((s) => s.id === id);
  }

  sessionOf(id?: string): Session | undefined {
    return id ? this.byId(id) : this.selected;
  }

  get inWindow(): Session[] {
    return this.list.filter((s) => s.terminal && s.status !== "inactive");
  }

  sessionInTerminal(terminal: Terminal): Session | undefined {
    for (const [id, t] of this.terminals) if (t === terminal) return this.list.find((s) => s.terminal === id);
    return undefined;
  }

  terminalOf(session: Session): Terminal | undefined {
    return session.terminal ? this.terminals.get(session.terminal) : undefined;
  }

  async refresh(): Promise<void> {
    try {
      const days = workspace.getConfiguration("agtc").get<number>("days", 7);
      const { surfaces, byId } = await linkedTerminals();
      this.terminals = byId;
      this.list = await collectSessions({ days, state: this.state, surfaces });
      this.render();
    } catch (error) {
      this.output.appendLine(`refresh failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
  }

  private render(): void {
    const selected = this.selected;
    this.panel.set({
      groups: buildGroups(this.list, this.showInactive),
      detail: selected ? buildDetail(selected) : undefined,
      selectedId: this.selectedId,
      showInactive: this.showInactive,
    });
    this.showWaiting();
  }

  private schedule(): void {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      await this.refresh();
      this.schedule();
    }, this.panel.visible ? POLL_VISIBLE_MS : POLL_HIDDEN_MS);
  }

  private showWaiting(): void {
    const waiting = this.list.filter((s) => s.status === "needs input" || s.status === "done");
    const input = waiting.filter((s) => s.status === "needs input").length;
    this.panel.badge(waiting.length, `${input} need input, ${waiting.length - input} done`);
    if (!waiting.length) return this.status.hide();
    this.status.text = `$(bell-dot) ${waiting.length} waiting`;
    this.status.tooltip = "agtc: jump to the session that has waited longest";
    this.status.show();
  }

  toggleInactive(): void {
    this.showInactive = !this.showInactive;
    this.render();
  }

  select(id: string, reveal: boolean): void {
    this.selectedId = id;
    this.render();
    if (reveal) this.panel.select(id);
  }

  async jump(session: Session): Promise<void> {
    this.select(session.id, true);
    const terminal = this.terminalOf(session);
    if (terminal) terminal.show();
    else if (session.status !== "inactive") window.setStatusBarMessage(`${session.title}: runs outside this window`, 3 * SECOND);
    this.state.mark(session.id);
    if (!openFolderHere(workDir(session))) await this.refresh();
  }

  jumpDigit(digit: number): Promise<void> | undefined {
    const session = this.inWindow[digit - 1];
    return session ? this.jump(session) : undefined;
  }

  /** J/K: the running session after or before the current one, wrapping; the current one is the active terminal's, else the selection. */
  jumpNext(direction: 1 | -1): Promise<void> | undefined {
    const running = this.inWindow;
    if (!running.length) return undefined;
    const active = window.activeTerminal && this.sessionInTerminal(window.activeTerminal);
    const currentId = active?.id ?? this.selectedId;
    const index = running.findIndex((s) => s.id === currentId);
    const next = index < 0 ? (direction > 0 ? 0 : running.length - 1) : (index + direction + running.length) % running.length;
    return this.jump(running[next]);
  }

  /** Needs input before done, the longest waiting first. */
  jumpWaiting(): Promise<void> | undefined {
    const waiting = this.list
      .filter((s) => s.status === "needs input" || s.status === "done")
      .sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || a.since - b.since);
    return waiting[0] ? this.jump(waiting[0]) : undefined;
  }

  markAllSeen(): Promise<void> {
    for (const session of this.list) this.state.mark(session.id);
    return this.refresh();
  }
}
