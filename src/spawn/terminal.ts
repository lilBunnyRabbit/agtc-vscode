import { type Terminal, TerminalLocation, window, workspace } from "vscode";

export function openAgentTerminal(dir: string, command: string, name: string): Terminal {
  const editor = workspace.getConfiguration("agtc").get<string>("terminalLocation", "panel") === "editor";
  const terminal = window.createTerminal({ name, cwd: dir, location: editor ? TerminalLocation.Editor : TerminalLocation.Panel });
  terminal.sendText(command, true);
  terminal.show();
  return terminal;
}
