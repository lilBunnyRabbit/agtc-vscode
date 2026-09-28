import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateStore } from "../src/model/state-store";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "agtc-state-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("StateStore", () => {
  test("marks never move backwards and persist", () => {
    const path = join(dir, "state.json");
    const store = StateStore.load(path);
    store.mark("a", 100);
    store.mark("a", 50);
    expect(store.seenAt("a")).toBe(100);
    expect(StateStore.load(path).seenAt("a")).toBe(100);
  });

  test("review links match by id, then by terminal after the start time, and settle the id", () => {
    const store = StateStore.load(join(dir, "reviews.json"));
    store.rememberReview({ pane: "%5", of: "subject", at: 10_000 });
    expect(store.reviewLinkOf({ id: "early", pane: "%5", startedAt: 1_000 })).toBeUndefined();
    const link = store.reviewLinkOf({ id: "reviewer", pane: "%5", startedAt: 12_000 });
    expect(link?.of).toBe("subject");
    expect(link?.id).toBe("reviewer");
    expect(store.reviewLinkOf({ id: "reviewer" })?.of).toBe("subject");
    expect(store.reviewLinkOf({ id: "other", pane: "%5", startedAt: 12_000 })).toBeUndefined();
  });

  test("a codex placeholder id does not settle the link", () => {
    const store = StateStore.load(join(dir, "codex.json"));
    store.rememberReview({ pane: "%7", of: "subject", at: 10_000 });
    const link = store.reviewLinkOf({ id: "pid-123", pane: "%7", startedAt: 12_000 });
    expect(link?.of).toBe("subject");
    expect(link?.id).toBeUndefined();
  });

  test("a new link in the same terminal replaces one still waiting for its id", () => {
    const store = StateStore.load(join(dir, "replace.json"));
    store.rememberReview({ pane: "%9", of: "one", at: 10_000 });
    store.rememberReview({ pane: "%9", of: "two", at: 20_000 });
    expect(store.reviewLinkOf({ id: "r", pane: "%9", startedAt: 21_000 })?.of).toBe("two");
  });
});

test("titles are remembered per session", () => {
  const store = StateStore.load(join(dir, "titles.json"));
  store.rememberTitle("a", "Landing perf");
  expect(store.titleOf("a")).toBe("Landing perf");
  expect(StateStore.load(join(dir, "titles.json")).titleOf("a")).toBe("Landing perf");
});
