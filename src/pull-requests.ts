import { exec } from "./lib/shell";
import { MINUTE } from "./lib/time";

export interface PullRequest {
  number: number;
  state: string;
  url: string;
  isDraft: boolean;
  title: string;
}

const TTL_MS = 5 * MINUTE;
const cache = new Map<string, { at: number; pr?: PullRequest }>();
const pending = new Set<string>();

/** The one thing here that uses the network, so it is opt-in, read for the selected session only and kept for minutes. */
export function pullRequestOf(root: string, branch: string, onChange: () => void): PullRequest | undefined {
  const key = `${root}\n${branch}`;
  const cached = cache.get(key);
  if ((!cached || Date.now() - cached.at > TTL_MS) && !pending.has(key)) {
    pending.add(key);
    void exec(["gh", "pr", "view", branch, "--json", "number,state,url,isDraft,title"], root).then(({ ok, output }) => {
      pending.delete(key);
      let pr: PullRequest | undefined;
      try {
        pr = ok ? (JSON.parse(output) as PullRequest) : undefined;
      } catch {
        pr = undefined;
      }
      const changed = JSON.stringify(pr) !== JSON.stringify(cache.get(key)?.pr);
      cache.set(key, { at: Date.now(), pr });
      if (changed) onChange();
    });
  }
  return cached?.pr;
}
