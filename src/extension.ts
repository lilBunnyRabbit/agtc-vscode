import { basename } from "node:path";
import { type ExtensionContext, Uri, commands, env, window } from "vscode";
import { App } from "./app";
import { SECOND } from "./lib/time";
import { resumeCommand, workDir } from "./model/session";
import { headDiffUris } from "./views/detail";
import type { SessionNode } from "./views/sessions";

export function activate(context: ExtensionContext): void {
  const output = window.createOutputChannel("agtc");
  const app = new App(output);

  context.subscriptions.push(
    output,
    app,
    commands.registerCommand("agtc.refresh", () => app.refresh()),
    commands.registerCommand("agtc.toggleInactive", () => app.sessions.toggleInactive()),
    commands.registerCommand("agtc.jump", (node?: SessionNode) => {
      const session = app.sessionOf(node);
      return session && app.jump(session);
    }),
    commands.registerCommand("agtc.jumpDigit", (digit: number) => app.jumpDigit(digit)),
    commands.registerCommand("agtc.next", () => app.jumpNext(1)),
    commands.registerCommand("agtc.previous", () => app.jumpNext(-1)),
    commands.registerCommand("agtc.jumpWaiting", () => app.jumpWaiting()),
    commands.registerCommand("agtc.markSeen", (node?: SessionNode) => {
      const session = app.sessionOf(node);
      if (session) app.state.mark(session.id);
      return app.refresh();
    }),
    commands.registerCommand("agtc.markAllSeen", () => app.markAllSeen()),
    commands.registerCommand("agtc.copyResume", async (node?: SessionNode) => {
      const session = app.sessionOf(node);
      if (!session) return;
      await env.clipboard.writeText(resumeCommand(session));
      window.setStatusBarMessage(`copied: ${resumeCommand(session)}`, 3 * SECOND);
    }),
    commands.registerCommand("agtc.openFolder", (node?: SessionNode) => {
      const session = app.sessionOf(node);
      if (session) return commands.executeCommand("vscode.openFolder", Uri.file(workDir(session)), { forceNewWindow: true });
    }),
    commands.registerCommand("agtc.openDiff", (file: string) => {
      const [head, current] = headDiffUris(file);
      return commands.executeCommand("vscode.diff", head, current, `${basename(file)} (HEAD ↔ working tree)`);
    }),
  );
}

export function deactivate(): void {}
