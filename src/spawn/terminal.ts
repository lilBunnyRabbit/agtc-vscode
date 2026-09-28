import { type Terminal, TerminalLocation, window, workspace } from "vscode";

const SHELL_READY_TIMEOUT_MS = 4000;

/** Text sent before the shell is up gets garbled into its startup, so the command waits for shell integration, or a timeout without it. */
export function openAgentTerminal(dir: string, command: string, name: string): Terminal {
  const editor = workspace.getConfiguration("agtc").get<string>("terminalLocation", "panel") === "editor";
  const terminal = window.createTerminal({ name, cwd: dir, location: editor ? TerminalLocation.Editor : TerminalLocation.Panel });
  terminal.show();
  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    listener.dispose();
    if (terminal.shellIntegration) terminal.shellIntegration.executeCommand(command);
    else terminal.sendText(command, true);
  };
  const listener = window.onDidChangeTerminalShellIntegration(({ terminal: changed }) => changed === terminal && send());
  if (terminal.shellIntegration) send();
  else setTimeout(send, SHELL_READY_TIMEOUT_MS);
  return terminal;
}
