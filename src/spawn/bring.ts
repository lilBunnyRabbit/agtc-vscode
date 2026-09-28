import { existsSync } from "node:fs";
import { window } from "vscode";
import { isProcessAlive } from "../lib/shell";
import { collapse } from "../lib/text";
import { type Session, resumeInvocation } from "../model/session";
import { checkoutName } from "../sources/git";
import type { SpawnContext } from "./flows";
import { openAgentTerminal } from "./terminal";

const EXIT_TIMEOUT_MS = 10_000;
const EXIT_POLL_MS = 200;

/**
 * A session running in another app moves here: its process is asked to exit, then the session
 * resumes in a terminal of this window. Two processes on one session id would write the same
 * transcript, so nothing starts until the old one is gone.
 */
export async function bringHere(ctx: SpawnContext, session: Session): Promise<void> {
  const say = (text: string): void => void window.setStatusBarMessage(`agtc: ${text}`, 5000);
  if (session.status === "inactive") return say("not running: resume it instead");
  if (ctx.terminalOf(session)) return say("already in this window");
  if (!session.pid || session.id.startsWith("pid-")) return say("no session to resume yet");
  if (session.status === "busy") return say("busy: bring it here once its turn ends, the turn would be lost");
  if (!existsSync(session.cwd)) return say("its directory is gone");
  const confirm = "Bring here";
  const detail = `The ${session.tool} process ${session.pid} in ${session.tty ?? "the other app"} is ended and the session resumes in a terminal of this window.`;
  if ((await window.showWarningMessage(`Bring "${collapse(session.title, 60)}" here?`, { modal: true, detail }, confirm)) !== confirm) return;
  try {
    process.kill(session.pid, "SIGTERM");
  } catch {
    // already gone
  }
  if (!(await exited(session.pid))) {
    void window.showErrorMessage(`${session.tool} process ${session.pid} did not exit: quit it where it runs, then resume`);
    return;
  }
  openAgentTerminal(session.cwd, resumeInvocation(session), await checkoutName(session.cwd));
  say(`brought ${session.tool} here`);
  setTimeout(() => void ctx.refresh(), 1500);
}

async function exited(pid: number): Promise<boolean> {
  for (let waited = 0; waited < EXIT_TIMEOUT_MS; waited += EXIT_POLL_MS) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, EXIT_POLL_MS));
  }
  return !isProcessAlive(pid);
}
