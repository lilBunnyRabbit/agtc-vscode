import { type QuickPickItem, window } from "vscode";
import { collapse } from "./lib/text";
import { relativeAge } from "./lib/time";
import { filterSessions, matchSnippet } from "./model/search";
import type { Session } from "./model/session";

interface Item extends QuickPickItem {
  session: Session;
}

const MAX_ITEMS = 60;

/** Every prompt of every session; the quick pick's own filter only sees labels, so the items are rebuilt per keystroke. */
export function searchSessions(sessions: Session[]): Promise<Session | undefined> {
  return new Promise((resolve) => {
    const pick = window.createQuickPick<Item>();
    pick.placeholder = "search names, prompts, repos and branches";
    const fill = () => {
      pick.items = filterSessions(sessions, { showInactive: true, query: pick.value })
        .slice(0, MAX_ITEMS)
        .map((session) => ({
          label: `${session.tool === "claude" ? "✳" : "⬡"} ${collapse(session.title, 80)}`,
          description: [session.repo, session.branch, session.status, relativeAge(session.since)].filter(Boolean).join(" · "),
          detail: matchSnippet(session, pick.value) ?? (session.lastPrompt ? collapse(session.lastPrompt, 140) : undefined),
          alwaysShow: true,
          session,
        }));
    };
    pick.onDidChangeValue(fill);
    pick.onDidAccept(() => {
      resolve(pick.selectedItems[0]?.session);
      pick.hide();
    });
    pick.onDidHide(() => {
      resolve(undefined);
      pick.dispose();
    });
    fill();
    pick.show();
  });
}
