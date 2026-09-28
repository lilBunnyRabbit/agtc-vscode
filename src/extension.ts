import { basename } from "node:path";
import { type ExtensionContext, Uri, commands, env, window, workspace } from "vscode";
import { SECOND } from "./lib/time";
import { type Session, resumeCommand, workDir } from "./model/session";
import { collectSessions } from "./model/sessions";
import { StateStore } from "./model/state-store";
import { STATE_FILE } from "./paths";
import { DetailProvider, headDiffUris } from "./views/detail";
import { type Node, type SessionNode, SessionsProvider } from "./views/sessions";

const POLL_VISIBLE_MS = 2 * SECOND;
const POLL_HIDDEN_MS = 10 * SECOND;

export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel("agtc");
  const state = StateStore.load(STATE_FILE);
  const sessions = new SessionsProvider();
  const detail = new DetailProvider();
  const tree = window.createTreeView("agtc.sessions", { treeDataProvider: sessions });
  const detailView = window.createTreeView("agtc.detail", { treeDataProvider: detail });
  let selectedId: string | undefined;
  let timer: NodeJS.Timeout | undefined;
  let disposed = false;

  const selected = (): Session | undefined => (selectedId ? sessions.byId(selectedId) : undefined);

  async function refresh(): Promise<void> {
    try {
      const days = workspace.getConfiguration("agtc").get<number>("days", 7);
      sessions.set(await collectSessions({ days, state }));
      detail.show(selected());
    } catch (error) {
      output.appendLine(`refresh failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
  }

  function schedule(): void {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await refresh();
      schedule();
    }, tree.visible ? POLL_VISIBLE_MS : POLL_HIDDEN_MS);
  }

  const sessionOf = (node?: Node): Session | undefined => (node?.kind === "session" ? node.session : selected());

  context.subscriptions.push(
    output,
    tree,
    detailView,
    { dispose: () => ((disposed = true), clearTimeout(timer)) },
    tree.onDidChangeSelection((event) => {
      const node = event.selection[0];
      selectedId = node?.kind === "session" ? node.session.id : undefined;
      detail.show(selected());
    }),
    tree.onDidChangeVisibility(() => schedule()),
    commands.registerCommand("agtc.refresh", () => refresh()),
    commands.registerCommand("agtc.toggleInactive", () => sessions.toggleInactive()),
    commands.registerCommand("agtc.markSeen", (node?: SessionNode) => {
      const session = sessionOf(node);
      if (session) state.mark(session.id);
      return refresh();
    }),
    commands.registerCommand("agtc.markAllSeen", () => {
      for (const repo of sessions.getChildren()) for (const node of sessions.getChildren(repo)) if (node.kind === "session") state.mark(node.session.id);
      return refresh();
    }),
    commands.registerCommand("agtc.copyResume", async (node?: SessionNode) => {
      const session = sessionOf(node);
      if (!session) return;
      await env.clipboard.writeText(resumeCommand(session));
      window.setStatusBarMessage(`copied: ${resumeCommand(session)}`, 3 * SECOND);
    }),
    commands.registerCommand("agtc.openFolder", (node?: SessionNode) => {
      const session = sessionOf(node);
      if (session) return commands.executeCommand("vscode.openFolder", Uri.file(workDir(session)), { forceNewWindow: true });
    }),
    commands.registerCommand("agtc.openDiff", (file: string) => {
      const [head, current] = headDiffUris(file);
      return commands.executeCommand("vscode.diff", head, current, `${basename(file)} (HEAD ↔ working tree)`);
    }),
  );

  void refresh().then(schedule);
}

export function deactivate(): void {}
