import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readJson } from "../lib/files";

export interface ReviewLink {
  /** Known up front for Claude, learned from its terminal for Codex. */
  id?: string;
  terminal: string;
  of: string;
  /** When the reviewer started; a session in that terminal from before is not it. */
  at: number;
}

interface State {
  seen: Record<string, number>;
  reviews?: ReviewLink[];
}

const MAX_REVIEWS = 100;
/** `ps` reports start times in whole seconds, so a reviewer may look older than the click that started it. */
const START_SLACK_MS = 5000;

export class StateStore {
  private seen: Record<string, number> = {};
  private reviews: ReviewLink[] = [];

  private constructor(private readonly path: string) {}

  static load(path: string): StateStore {
    const store = new StateStore(path);
    const state = readJson<Partial<State>>(path);
    if (state) {
      store.seen = state.seen ?? {};
      store.reviews = state.reviews ?? [];
    }
    return store;
  }

  seenAt(id: string): number {
    return this.seen[id] ?? 0;
  }

  mark(id: string, at = Date.now()): void {
    if (this.seenAt(id) >= at) return;
    this.seen[id] = at;
    this.save();
  }

  /** A link still waiting for its id in the same terminal is stale: the terminal was reused. */
  rememberReview(link: ReviewLink): void {
    this.reviews = [...this.reviews.filter((r) => r.id || r.terminal !== link.terminal), link].slice(-MAX_REVIEWS);
    this.save();
  }

  /** A terminal match settles the id, except for a Codex process whose id is a placeholder until its first message. */
  reviewLinkOf(session: { id: string; terminal?: string; startedAt?: number }): ReviewLink | undefined {
    const byId = this.reviews.find((r) => r.id === session.id);
    if (byId) return byId;
    if (!session.terminal) return undefined;
    const link = this.reviews.find((r) => !r.id && r.terminal === session.terminal && (session.startedAt ?? Infinity) >= r.at - START_SLACK_MS);
    if (link && !session.id.startsWith("pid-")) {
      link.id = session.id;
      this.save();
    }
    return link;
  }

  save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify({ seen: this.seen, reviews: this.reviews } satisfies State));
    } catch {
      // A read-only cache dir only costs persistence, not functionality.
    }
  }
}
