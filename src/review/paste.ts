import type { Terminal } from "vscode";

/**
 * Text into an agent's input, unsent. Bracketed paste keeps the newlines inside the input; sent
 * plain, the first one would submit a half message.
 */
export function pasteInto(terminal: Terminal, text: string): void {
  terminal.sendText(`\x1b[200~${text.trimEnd()}\x1b[201~`, false);
  terminal.show();
}
