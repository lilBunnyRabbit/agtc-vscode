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

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = window.createWebviewPanel("agtc.home", "agtc", ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [Uri.joinPath(this.extensionUri, "media")],
    });
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
<section id="composer">
  <h2>New agent</h2>
  <div class="field"><label>agent</label><div class="segment" id="tool"><button data-tool="claude" class="on">✳ claude</button><button data-tool="codex">⬡ codex</button></div></div>
  <div class="field"><label>in</label><select id="dir"></select><button id="browse">browse…</button></div>
  <div class="field"><label><input type="checkbox" id="wt"> new worktree</label><input id="branch" placeholder="branch" disabled></div>
  <div class="field"><label>task</label><textarea id="task" rows="5" placeholder="optional, ⌘⏎ starts"></textarea></div>
  <div class="field"><label></label><button id="start" class="primary">start</button><span id="note"></span></div>
</section>
<section id="needs"><h2>Needs you</h2><div id="needs-list"></div></section>
<section id="all"><h2>Sessions</h2><div id="all-list"></div></section>
<script nonce="${nonce}" src="${asset("home.js")}"></script>
</body>
</html>`;
  }
}
