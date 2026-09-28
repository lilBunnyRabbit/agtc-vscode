import { randomBytes } from "node:crypto";
import { EventEmitter, Uri, type Webview, type WebviewView, type WebviewViewProvider, type WebviewViewResolveContext } from "vscode";
import type { ViewState } from "./model";

export type ViewMessage =
  | { type: "select"; id: string }
  | { type: "jump"; id: string }
  | { type: "openFile"; file: string }
  | { type: "command"; command: string; id?: string };

export class SessionsPanel implements WebviewViewProvider {
  private view: WebviewView | undefined;
  private last: ViewState | undefined;
  private readonly messages = new EventEmitter<ViewMessage>();
  readonly onMessage = this.messages.event;
  private readonly visibility = new EventEmitter<boolean>();
  readonly onDidChangeVisibility = this.visibility.event;

  constructor(private readonly extensionUri: Uri) {}

  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  resolveWebviewView(view: WebviewView, _context: WebviewViewResolveContext): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [Uri.joinPath(this.extensionUri, "media")] };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message: ViewMessage) => this.messages.fire(message));
    view.onDidChangeVisibility(() => this.visibility.fire(view.visible));
    view.onDidDispose(() => (this.view = undefined));
    if (this.last) void view.webview.postMessage({ type: "state", state: this.last });
  }

  set(state: ViewState): void {
    this.last = state;
    void this.view?.webview.postMessage({ type: "state", state });
  }

  select(id: string): void {
    void this.view?.webview.postMessage({ type: "select", id });
  }

  badge(count: number, tooltip: string): void {
    if (this.view) this.view.badge = count ? { value: count, tooltip } : undefined;
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
</head>
<body>
<main id="list" tabindex="0" aria-label="Sessions"></main>
<aside id="detail"></aside>
<script nonce="${nonce}" src="${asset("view.js")}"></script>
</body>
</html>`;
  }
}
