import { ProgressLocation, window } from "vscode";
import { collapse } from "./lib/text";
import type { Session, Status } from "./model/session";

const WANTS: Status[] = ["needs input", "done"];

/**
 * A toast when a session starts to need you while its terminal is not in front. Information
 * messages cannot dismiss themselves, a progress notification can; its only button is cancel,
 * so the timed toast names the chord instead of offering a jump button.
 */
export class Notifier {
  private previous = new Map<string, Status>();
  private primed = false;

  update(sessions: Session[], seconds: number, jump: (id: string) => void): void {
    const next = new Map(sessions.map((s) => [s.id, s.status]));
    if (this.primed) {
      for (const session of sessions) {
        if (!WANTS.includes(session.status) || session.viewed) continue;
        if (this.previous.get(session.id) === session.status) continue;
        void this.toast(session, seconds, jump);
      }
    }
    this.previous = next;
    this.primed = true;
  }

  private async toast(session: Session, seconds: number, jump: (id: string) => void): Promise<void> {
    const what = session.verdict ? `review ${session.verdict.ready ? "ready" : "not ready"}: ${session.verdict.text}` : session.status === "done" ? "done" : `needs input${session.waitingFor ? `: ${session.waitingFor}` : ""}`;
    const title = `${collapse(session.title, 60)} · ${what}`;
    if (seconds <= 0) {
      if ((await window.showInformationMessage(title, "Jump")) === "Jump") jump(session.id);
      return;
    }
    await window.withProgress({ location: ProgressLocation.Notification, title: `${title} (⌘⌥N jumps)`, cancellable: true }, (_progress, token) => {
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, seconds * 1000);
        token.onCancellationRequested(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    });
  }
}
