import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readJson } from "../lib/files";

export interface ReviewLink {
  /** Known up front for Claude, learned from its pane for Codex. */
  id?: string;
  pane: string;
  of: string;
  /** When the reviewer started; a session in that pane from before is not it. */
  at: number;
}

interface State {
  seen: Record<string, number>;
  reviews?: ReviewLink[];
  titles?: Record<string, string>;
}

const MAX_TITLES = 500;

const MAX_REVIEWS = 100;
/** `ps` reports start times in whole seconds, so a reviewer may look older than the click that started it. */
const START_SLACK_MS = 5000;

export class StateStore {
  private seen: Record<string, number> = {};
  private reviews: ReviewLink[] = [];
  private titles: Record<string, string> = {};

  private constructor(private readonly path: string) {}

  static load(path: string): StateStore {
    const store = new StateStore(path);
    const state = readJson<Partial<State>>(path);
    if (state) {
      store.seen = state.seen ?? {};
      store.reviews = state.reviews ?? [];
      store.titles = state.titles ?? {};
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

  titleOf(id: string): string | undefined {
    return this.titles[id];
  }

  /** A title lives only in the terminal that shows it; kept here so the row keeps its name after the terminal is gone. */
  rememberTitle(id: string, title: string): void {
    if (this.titles[id] === title) return;
    const entries = Object.entries(this.titles).filter(([key]) => key !== id);
    this.titles = Object.fromEntries([...entries.slice(-MAX_TITLES), [id, title]]);
    this.save();
  }

  /** A link still waiting for its id in the same pane is stale: the pane was reused. */
  rememberReview(link: ReviewLink): void {
    this.reviews = [...this.reviews.filter((r) => r.id || r.pane !== link.pane), link].slice(-MAX_REVIEWS);
    this.save();
  }

  /** A pane match settles the id, except for a Codex process whose id is a placeholder until its first message. */
  reviewLinkOf(session: { id: string; pane?: string; startedAt?: number }): ReviewLink | undefined {
    const byId = this.reviews.find((r) => r.id === session.id);
    if (byId) return byId;
    if (!session.pane) return undefined;
    const link = this.reviews.find((r) => !r.id && r.pane === session.pane && (session.startedAt ?? Infinity) >= r.at - START_SLACK_MS);
    if (link && !session.id.startsWith("pid-")) {
      link.id = session.id;
      this.save();
    }
    return link;
  }

  save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify({ seen: this.seen, reviews: this.reviews, titles: this.titles } satisfies State));
    } catch {
      // A read-only cache dir only costs persistence, not functionality.
    }
  }
}
