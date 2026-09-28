import { ThemeColor, ThemeIcon } from "vscode";
import { collapse } from "../lib/text";
import { relativeAge } from "../lib/time";
import type { Session, Status } from "../model/session";

export const TOOL_GLYPH: Record<Session["tool"], string> = { claude: "✳", codex: "⬡" };
/** A label past this hides the description in a sidebar of usual width. */
const LABEL_WIDTH = 44;

export function statusIcon(status: Status): ThemeIcon {
  switch (status) {
    case "needs input":
      return new ThemeIcon("bell-dot", new ThemeColor("charts.red"));
    case "done":
      return new ThemeIcon("pass-filled", new ThemeColor("charts.green"));
    case "busy":
      return new ThemeIcon("sync~spin", new ThemeColor("charts.blue"));
    case "idle":
      return new ThemeIcon("circle-outline", new ThemeColor("charts.yellow"));
    case "inactive":
      return new ThemeIcon("circle-outline", new ThemeColor("disabledForeground"));
  }
}

export function sessionLabel(session: Session, underSubject: boolean, digit?: number): string {
  const glyphs = `${digit ?? " "} ${TOOL_GLYPH[session.tool]}${session.worktree ? " ⎇" : ""}`;
  return `${glyphs} ${underSubject ? "╰ review" : collapse(session.title, LABEL_WIDTH)}`;
}

export function sessionDescription(session: Session, now = Date.now()): string {
  const parts = [session.verdict ? (session.verdict.ready ? "ready" : "not ready") : session.status, relativeAge(session.since, now)];
  if (session.branch) parts.push(session.branch);
  const text = parts.join(" · ");
  return session.terminal || session.status === "inactive" ? text : `⇗ ${text}`;
}

export function repoDescription(sessions: Session[]): string {
  const waiting = sessions.filter((s) => s.status === "needs input").length;
  const done = sessions.filter((s) => s.status === "done").length;
  const parts = [];
  if (waiting) parts.push(`${waiting} input`);
  if (done) parts.push(`${done} done`);
  parts.push(`${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`);
  return parts.join(" · ");
}
