import { type Memento, type OutputChannel, StatusBarAlignment, Uri, commands, env, window, workspace } from "vscode";
import { type Switch, editorEnv, editorKnows, needsPin, openFolderHere } from "./folder";
import { SECOND } from "./lib/time";
import { newWindow, splitPane, tmuxPanes } from "./tmux/tmux";
import { Viewer } from "./tmux/viewer";
import { type Session, STATUS_PRIORITY, workDir } from "./model/session";
import { collectSessions } from "./model/sessions";
import { StateStore } from "./model/state-store";
import { HOME, STATE_FILE } from "./paths";
import { existsSync } from "node:fs";
import { Notifier } from "./notify";
import { pullRequestOf } from "./pull-requests";
import { attachFiles } from "./spawn/flows";
import { reviewerReport } from "./review/report";
import { ReviewThreads } from "./review/threads";
import { factsOf } from "./worktrees/cleanup";
import { readWorktrees } from "./worktrees/read";
import { type Worktree, isRemovable } from "./worktrees/state";
import { actionTable, buildDetail, buildGroups, buildStats, checkoutsOf, inactiveRows } from "./views/model";
import { HomePanel } from "./views/home";
import { SessionsPanel } from "./views/panel";
import { type Launch, WindowMemory } from "./spawn/memory";
import { knownCheckouts, startFromComposer } from "./spawn/flows";

const POLL_VISIBLE_MS = 2 * SECOND;
const POLL_HIDDEN_MS = 10 * SECOND;
const WORKTREES_TTL_MS = 60 * SECOND;

export class App {
  readonly state = StateStore.load(STATE_FILE);
  readonly panel: SessionsPanel;
  readonly memory: WindowMemory;
  readonly home: HomePanel;
  private readonly status = window.createStatusBarItem(StatusBarAlignment.Left, 50);
  private readonly viewer = new Viewer();
  private readonly replies = new Map<string, string | undefined>();
  readonly threads = new ReviewThreads();
  private readonly worktrees = new Map<string, { at: number; byDir: Map<string, Worktree> }>();
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
        case "attach":
          return void attachFiles().then((files) => files.length && this.home.attached(files));
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
        case "openUrl":
          return void env.openExternal(Uri.parse(message.url));
        case "command":
          return void commands.executeCommand(message.command, message.id);
      }
    });
    void this.start();
  }

  private async start(): Promise<void> {
    await this.refresh();
    const config = workspace.getConfiguration("agtc");
    const afterSwap = await this.memory.afterSwap();
    if (!afterSwap && config.get<boolean>("showOnStartup", true)) this.home.show(true);
    const deferred = await this.memory.takeDeferred();
    if (deferred && existsSync(deferred.dir)) await this.begin(deferred);
    void this.viewer.sweep();
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

  /** Sessions the window's terminal can show. */
  get reachable(): Session[] {
    return this.list.filter((s) => s.pane && s.status !== "inactive");
  }

  show(pane: string): Promise<boolean> {
    return this.viewer.show(pane);
  }

  async refresh(): Promise<void> {
    try {
      const days = workspace.getConfiguration("agtc").get<number>("days", 7);
      const viewerTty = await this.viewer.clientTty();
      const surfaces = await tmuxPanes(new Map(viewerTty ? [[viewerTty, this.viewer.active]] : []));
      this.list = await collectSessions({ days, state: this.state, surfaces });
      this.render();
      this.threads.sync(this.list);
      this.notifier.update(this.list, workspace.getConfiguration("agtc").get<number>("notificationSeconds", 12), (id) => {
        const session = this.byId(id);
        if (session) void this.jump(session);
      });
    } catch (error) {
      this.output.appendLine(`refresh failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
  }

  /** Reading a repo's worktrees runs git in each; done for the selected session's repo only, at most once a minute, off the render path. */
  private worktreeState(session: Session): string | undefined {
    const { mainRoot, root, worktree } = session;
    if (!mainRoot || !root || !worktree) return undefined;
    const cached = this.worktrees.get(mainRoot);
    if (!cached || Date.now() - cached.at > WORKTREES_TTL_MS) {
      this.worktrees.set(mainRoot, { at: Date.now(), byDir: cached?.byDir ?? new Map() });
      void readWorktrees(mainRoot, this.list).then((report) => {
        this.worktrees.set(mainRoot, { at: Date.now(), byDir: new Map(report?.worktrees.map((w) => [w.dir, w])) });
        this.render();
      });
    }
    const found = cached?.byDir.get(root);
    return found ? `${factsOf(found)}${isRemovable(found) ? " · safe to remove" : ""}` : undefined;
  }

  private pullRequest(session: Session) {
    if (!session.root || !session.branch || !existsSync(session.root)) return undefined;
    if (!workspace.getConfiguration("agtc").get<boolean>("pullRequests", false)) return undefined;
    return pullRequestOf(session.root, session.branch, () => this.render());
  }

  forgetWorktrees(): void {
    this.worktrees.clear();
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
      detail: selected ? buildDetail(selected, Date.now(), { worktreeState: this.worktreeState(selected), pullRequest: this.pullRequest(selected) }) : undefined,
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
    if (session.pane) await this.viewer.show(session.pane);
    else if (session.status !== "inactive") window.setStatusBarMessage(`${session.title}: runs outside tmux, "bring here" moves it in`, 4 * SECOND);
    this.state.mark(session.id);
    if ((await this.openFolder(workDir(session))) === "same") await this.refresh();
  }

  openFolder(dir: string): Promise<Switch> {
    return openFolderHere(dir, () => this.memory.willRestart());
  }

  /**
   * An agent in a tmux window, in an editor window that shows its checkout. The editor switches
   * first and its lock has to name the checkout before the agent starts, or the agent comes up
   * without the editor. A window's first switch restarts the extension host: the launch is kept
   * and runs after the restart.
   */
  async launch(dir: string, command: string, name: string, beside?: string): Promise<string | undefined> {
    if (needsPin()) {
      await this.memory.defer({ dir, command, name });
      await this.openFolder(dir);
      return undefined;
    }
    await this.openFolder(dir);
    return this.begin({ dir, command, name }, beside);
  }

  private async begin({ dir, command, name }: Launch, beside?: string): Promise<string | undefined> {
    await editorKnows(dir);
    const line = command.startsWith("claude") ? `${editorEnv(dir)}${command}` : command;
    const pane = beside ? await splitPane(beside, dir, line) : await newWindow(dir, line, name);
    if (!pane) {
      void window.showErrorMessage(`agtc: could not open a tmux ${beside ? "pane" : "window"} in ${dir}`);
      return undefined;
    }
    await this.viewer.show(pane);
    setTimeout(() => void this.refresh(), 1500);
    return pane;
  }

  jumpDigit(digit: number): Promise<void> | undefined {
    const session = this.reachable[digit - 1];
    return session ? this.jump(session) : undefined;
  }

  /** J/K: the running session after or before the selected one, wrapping. */
  jumpNext(direction: 1 | -1): Promise<void> | undefined {
    const running = this.reachable;
    if (!running.length) return undefined;
    const index = running.findIndex((s) => s.id === this.selectedId);
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
