import { basename } from "node:path";
import { type ExtensionContext, Uri, commands, env, window } from "vscode";
import { App } from "./app";
import { SECOND } from "./lib/time";
import { resumeCommand, workDir } from "./model/session";
import { compose, moveToWorktree, newAgent, newWorktree, resumeAgent } from "./spawn/flows";

export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel("agtc");
  const app = new App(output, context.extensionUri, context.globalState);

  context.subscriptions.push(
    output,
    app,
    window.registerWebviewViewProvider("agtc.sessions", app.panel, { webviewOptions: { retainContextWhenHidden: true } }),
    commands.registerCommand("agtc.refresh", () => app.refresh()),
    commands.registerCommand("agtc.toggleInactive", () => app.toggleInactive()),
    commands.registerCommand("agtc.jump", (id?: string) => {
      const session = app.sessionOf(id);
      return session && app.jump(session);
    }),
    commands.registerCommand("agtc.jumpDigit", (digit: number) => app.jumpDigit(digit)),
    commands.registerCommand("agtc.next", () => app.jumpNext(1)),
    commands.registerCommand("agtc.previous", () => app.jumpNext(-1)),
    commands.registerCommand("agtc.jumpWaiting", () => app.jumpWaiting()),
    commands.registerCommand("agtc.markSeen", (id?: string) => {
      const session = app.sessionOf(id);
      if (session) app.state.mark(session.id);
      return app.refresh();
    }),
    commands.registerCommand("agtc.markAllSeen", () => app.markAllSeen()),
    commands.registerCommand("agtc.new", (id?: string) => newAgent(app, app.sessionOf(id))),
    commands.registerCommand("agtc.newWorktree", (id?: string) => newWorktree(app, app.sessionOf(id))),
    commands.registerCommand("agtc.moveToWorktree", (id?: string) => {
      const session = app.sessionOf(id);
      return session && moveToWorktree(app, session);
    }),
    commands.registerCommand("agtc.resume", (id?: string) => {
      const session = app.sessionOf(id);
      return session && resumeAgent(app, session);
    }),
    commands.registerCommand("agtc.compose", () => compose(app)),
    commands.registerCommand("agtc.copyResume", async (id?: string) => {
      const session = app.sessionOf(id);
      if (!session) return;
      await env.clipboard.writeText(resumeCommand(session));
      window.setStatusBarMessage(`copied: ${resumeCommand(session)}`, 3 * SECOND);
    }),
    commands.registerCommand("agtc.openFolder", (id?: string) => {
      const session = app.sessionOf(id);
      if (session) return commands.executeCommand("vscode.openFolder", Uri.file(workDir(session)), { forceNewWindow: true });
    }),
    commands.registerCommand("agtc.openDiff", (file: string) => {
      const uri = Uri.file(file);
      const head = uri.with({ scheme: "git", query: JSON.stringify({ path: file, ref: "HEAD" }) });
      return commands.executeCommand("vscode.diff", head, uri, `${basename(file)} (HEAD ↔ working tree)`);
    }),
  );
}

export function deactivate(): void {}
