import { randomBytes } from "node:crypto";
import { EventEmitter, Uri, ViewColumn, type Webview, type WebviewPanel, window } from "vscode";
import type { ComposerInput } from "../spawn/flows";
import type { HomeState } from "./model";

export type HomeMessage = { type: "start"; input: ComposerInput } | { type: "browse" } | { type: "command"; command: string; id?: string } | { type: "ready" };

export class HomePanel {
  private panel: WebviewPanel | undefined;
  private last: HomeState | undefined;
  private readonly messages = new EventEmitter<HomeMessage>();
  readonly onMessage = this.messages.event;
  private readonly visibility = new EventEmitter<boolean>();
  readonly onDidChangeVisibility = this.visibility.event;

  constructor(private readonly extensionUri: Uri) {}

  get visible(): boolean {
    return this.panel?.visible ?? false;
  }

  show(preserveFocus = false): void {
    if (this.panel) this.panel.reveal(undefined, preserveFocus);
    else this.adopt(window.createWebviewPanel("agtc.home", "agtc", { viewColumn: ViewColumn.Active, preserveFocus }, this.options()));
    if (!preserveFocus) void this.panel?.webview.postMessage({ type: "focus" });
  }

  private options() {
    return { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [Uri.joinPath(this.extensionUri, "media")] };
  }

  /** Also VS Code's restored panel after an extension host restart, so the tab keeps its place. */
  adopt(panel: WebviewPanel): void {
    panel.webview.options = this.options();
    panel.iconPath = Uri.joinPath(this.extensionUri, "media", "icon.svg");
    panel.webview.html = this.html(panel.webview);
    panel.webview.onDidReceiveMessage((message: HomeMessage) => this.messages.fire(message));
    panel.onDidChangeViewState(() => this.visibility.fire(panel.visible));
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.visibility.fire(false);
    });
    this.panel = panel;
    if (this.last) void panel.webview.postMessage({ type: "state", state: this.last });
  }

  set(state: HomeState): void {
    this.last = state;
    void this.panel?.webview.postMessage({ type: "state", state });
  }

  picked(dir: string): void {
    void this.panel?.webview.postMessage({ type: "picked", dir });
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private html(webview: Webview): string {
    const nonce = randomBytes(16).toString("hex");
    const asset = (file: string) => webview.asWebviewUri(Uri.joinPath(this.extensionUri, "media", file));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset("view.css")}">
<link rel="stylesheet" href="${asset("home.css")}">
</head>
<body class="home">
<header><span class="logo">✳</span><h1>Agent Traffic Control</h1><span id="summary"></span></header>
<section id="composer" class="card">
  <div class="toolbar">
    <div class="segment" id="tool"><button data-tool="claude" class="on">✳ Claude</button><button data-tool="codex">⬡ Codex</button></div>
    <span class="in">in</span>
    <select id="dir"></select>
    <button id="browse" class="ghost" title="pick a folder">…</button>
    <label class="switch"><input type="checkbox" id="wt"> new worktree</label>
    <input id="branch" placeholder="branch" disabled>
  </div>
  <textarea id="task" rows="4" placeholder="What should it do? Empty starts the agent with no task."></textarea>
  <div class="toolbar end"><span id="note"></span><button id="start" class="primary">Start <kbd>⌘⏎</kbd></button></div>
</section>
<section id="needs"><h2>Needs you</h2><div id="needs-list"></div></section>
<section id="stats"><h2>Activity</h2><div id="cards" class="cards"></div><table id="repos"></table></section>
<script nonce="${nonce}" src="${asset("home.js")}"></script>
</body>
</html>`;
  }
}
