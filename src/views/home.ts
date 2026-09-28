import { randomBytes } from "node:crypto";
import { EventEmitter, Uri, ViewColumn, type Webview, type WebviewPanel, window } from "vscode";
import type { ComposerInput } from "../spawn/flows";
import type { Checkout, HomeState } from "./model";

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

  picked(checkout: Checkout): void {
    void this.panel?.webview.postMessage({ type: "picked", checkout });
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
<div class="page">
<header><span class="logo">✳</span><h1>Agent Traffic Control</h1><span id="summary"></span></header>
<section id="composer" class="card">
  <textarea id="task" rows="4" placeholder="What should the agent do? Leave empty to start without a task."></textarea>
  <div class="fields">
    <div class="fieldset">
      <span class="legend">Agent</span>
      <div class="segment" id="tool"><button data-tool="claude" class="on">✳ Claude</button><button data-tool="codex">⬡ Codex</button></div>
    </div>
    <div class="fieldset">
      <span class="legend">Runs in</span>
      <div class="segment" id="where"><button data-where="here" class="on">the checkout</button><button data-where="worktree">a new worktree</button></div>
    </div>
    <div class="fieldset wide">
      <span class="legend">Checkout</span>
      <div class="picker"><select id="dir"></select><button id="browse">Browse…</button></div>
      <div id="dir-path" class="hint"></div>
    </div>
    <div class="fieldset wide" id="branch-field" hidden>
      <span class="legend">Branch</span>
      <input id="branch" placeholder="feat/short-name">
      <div id="branch-path" class="hint"></div>
    </div>
  </div>
  <div class="toolbar end"><span id="note"></span><button id="start" class="primary">Start <kbd>⌘⏎</kbd></button></div>
</section>
<section id="resume"><div class="section-head"><h2>Resume</h2><input id="filter" placeholder="filter by name, prompt, repo or branch"></div><div id="resume-list"></div><button id="more" class="ghost">show more</button></section>
<section id="stats"><h2>Activity</h2><div id="cards" class="cards"></div><table id="repos"></table></section>
</div>
<script nonce="${nonce}" src="${asset("home.js")}"></script>
</body>
</html>`;
  }
}
