import { existsSync } from "node:fs";
import type { Session } from "../model/session";
import { resumeInvocation } from "../model/tools";
import { checkoutName } from "../sources/git";
import type { Remembered } from "./memory";
import { openAgentTerminal } from "./terminal";

/** Every remembered session without a live process comes back in a terminal in its checkout. */
export async function restoreSessions(remembered: Remembered[], live: Session[]): Promise<number> {
  const running = new Set(live.filter((s) => s.status !== "inactive").map((s) => s.id));
  let opened = 0;
  for (const r of remembered) {
    if (running.has(r.id) || !existsSync(r.cwd)) continue;
    openAgentTerminal(r.cwd, resumeInvocation(r), await checkoutName(r.cwd));
    opened++;
  }
  return opened;
}
