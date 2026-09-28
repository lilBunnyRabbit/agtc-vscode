import { type Memento, type OutputChannel, StatusBarAlignment, type Terminal, Uri, commands, window, workspace } from "vscode";
import { currentFolder, openFolderHere } from "./folder";
import { SECOND } from "./lib/time";
import { linkedTerminals } from "./link/terminals";
import { type Session, STATUS_PRIORITY, workDir } from "./model/session";
import { collectSessions } from "./model/sessions";
import { StateStore } from "./model/state-store";
import { HOME, STATE_FILE } from "./paths";
import { Notifier } from "./notify";
import { reviewerReport } from "./review/report";
import { ReviewThreads } from "./review/threads";
import { actionTable, buildDetail, buildGroups, buildStats, checkoutsOf, inactiveRows } from "./views/model";
import { HomePanel } from "./views/home";
import { SessionsPanel } from "./views/panel";
import { type Remembered, WindowMemory } from "./spawn/memory";
import { restoreSessions } from "./spawn/restore";
import { knownCheckouts, startFromComposer } from "./spawn/flows";

const POLL_VISIBLE_MS = 2 * SECOND;
const POLL_HIDDEN_MS = 10 * SECOND;

export class App {
  readonly state = StateStore.load(STATE_FILE);
  readonly panel: SessionsPanel;
  readonly memory: WindowMemory;
  readonly home: HomePanel;
  private readonly status = window.createStatusBarItem(StatusBarAlignment.Left, 50);
  private terminals = new Map<string, Terminal>();
  private readonly replies = new Map<string, string | undefined>();
  readonly threads = new ReviewThreads();
  private readonly notifier = new Notifier();
  private list: Session[] = [];
  private selectedId: string | undefined;
  private showInactive = false;
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(
    private readonly output: OutputChannel,
    extensionUri: Uri,
    memento: Memento,
  ) {
    this.panel = new SessionsPanel(extensionUri);
    this.memory = new WindowMemory(memento);
    this.home = new HomePanel(extensionUri);
    this.home.onDidChangeVisibility(() => this.schedule());
    this.home.onMessage((message) => {
      switch (message.type) {
        case "start":
          return void startFromComposer(this, message.input);
        case "browse":
          return void window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false }).then((uris) => uris?.[0] && this.home.picked(checkoutsOf([uris[0].fsPath], HOME)[0]));
        case "command":
          return void commands.executeCommand(message.command, message.id);
        case "ready":
          return this.render();
      }
    });
    this.status.command = "agtc.jumpWaiting";
    this.panel.onDidChangeVisibility((visible) => {
      this.schedule();
      if (visible && this.home.visible === false) this.home.show(true);
    });
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
    void this.start();
  }

  private async start(): Promise<void> {
    await this.refresh();
    const config = workspace.getConfiguration("agtc");
    const afterSwap = await this.memory.afterSwap();
    if (!afterSwap && config.get<boolean>("showOnStartup", true)) this.home.show(true);
    const remembered = await this.memory.take(currentFolder());
    if (remembered.length && config.get<boolean>("resumeOnStartup", true)) {
      const opened = await restoreSessions(remembered, this.list);
      if (opened) {
        window.setStatusBarMessage(`agtc: resumed ${opened} ${opened === 1 ? "agent" : "agents"}`, 5 * SECOND);
        await this.refresh();
      }
    }
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.status.dispose();
    this.home.dispose();
    this.threads.dispose();
  }

  get sessions(): Session[] {
    return this.list;
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
      this.threads.sync(this.list);
      this.notifier.update(this.list, workspace.getConfiguration("agtc").get<number>("notificationSeconds", 12), (id) => {
        const session = this.byId(id);
        if (session) void this.jump(session);
      });
      await this.memory.remember(currentFolder(), this.remembered());
    } catch (error) {
      this.output.appendLine(`refresh failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
  }

  /** Codex ids stay placeholders until the first message; nothing to resume there yet. */
  private remembered(): Remembered[] {
    return this.inWindow.filter((s) => !s.id.startsWith("pid-")).map((s) => ({ id: s.id, tool: s.tool, cwd: s.cwd, reviewOf: s.reviewOf }));
  }

  /** A finished session's transcript no longer changes, so its last message is read once per last-activity time. */
  private replyOf(session: Session): string | undefined {
    const key = `${session.id}:${session.since}`;
    if (!this.replies.has(key)) this.replies.set(key, reviewerReport(session));
    return this.replies.get(key);
  }

  private render(): void {
    const selected = this.selected;
    const actions = actionTable();
    this.panel.set({
      groups: buildGroups(this.list, this.showInactive),
      detail: selected ? buildDetail(selected) : undefined,
      selectedId: this.selectedId,
      showInactive: this.showInactive,
      actions,
    });
    this.home.set({
      inactive: inactiveRows(this.list, Date.now(), (s) => this.replyOf(s)),
      stats: buildStats(this.list),
      checkouts: checkoutsOf(knownCheckouts(this.list), HOME),
      actions,
    });
    this.showWaiting();
  }

  private schedule(): void {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      await this.refresh();
      this.schedule();
    }, this.panel.visible || this.home.visible ? POLL_VISIBLE_MS : POLL_HIDDEN_MS);
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
    if (!(await this.openFolder(workDir(session)))) await this.refresh();
  }

  openFolder(dir: string): Promise<boolean> {
    return openFolderHere(dir, (from, to) => this.memory.move(from, to));
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
