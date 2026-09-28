import { describe, expect, test } from "bun:test";
import { actionsOf, buildDetail, buildGroups, buildStats, digitsOf, inactiveRows } from "../src/views/model";
import { session } from "./fixtures";

const NOW = 10_000_000;

describe("buildGroups", () => {
  test("groups by repo in list order, inactive hidden unless asked", () => {
    const sessions = [
      session({ repo: "a", id: "a1", status: "busy", terminal: "t1", since: NOW - 5000 }),
      session({ repo: "a", id: "a2", status: "inactive" }),
      session({ repo: "b", id: "b1", status: "done" }),
    ];
    const groups = buildGroups(sessions, false, NOW);
    expect(groups.map((g) => g.repo)).toEqual(["a", "b"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["a1"]);
    expect(groups[1].description).toBe("1 done · 1 session");
    expect(buildGroups(sessions, true, NOW)[0].rows.map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  test("digits go to sessions in this window, external ones are marked", () => {
    const sessions = [
      session({ id: "ours", status: "idle", terminal: "t1" }),
      session({ id: "theirs", status: "idle" }),
      session({ id: "old", status: "inactive", terminal: "t2" }),
    ];
    expect([...digitsOf(sessions)]).toEqual([["ours", 1]]);
    const rows = buildGroups(sessions, true, NOW)[0].rows;
    expect(rows.map((r) => [r.digit, r.external])).toEqual([
      [1, false],
      [undefined, true],
      [undefined, false],
    ]);
  });

  test("a reviewer under its subject is a review row", () => {
    const rows = buildGroups([session({ id: "s" }), session({ id: "r", reviewOf: "s", verdict: { ready: true, text: "ready" } })], false, NOW)[0].rows;
    expect(rows[1].review).toBe(true);
    expect(rows[1].verdict?.ready).toBe(true);
  });
});

describe("buildDetail", () => {
  test("checkout, changes with files, prompts with the two before", () => {
    const detail = buildDetail(
      session({
        cwd: "/repo/x",
        root: "/repo/x",
        branch: "feat",
        changes: { paths: ["a.ts", "b.ts"], insertions: 3, deletions: 1, base: "origin/main", ahead: 2 },
        prompts: ["one", "two", "three", "four"],
        lastPrompt: "four",
        lastPromptAt: NOW - 60_000,
      }),
      NOW,
    );
    const labels = detail.items.map((i) => i.label);
    expect(labels).toEqual(["/repo/x", "feat", "2 files +3 −1", "four"]);
    expect(detail.items[2].description).toBe("2 ahead of origin/main");
    expect(detail.items[2].children?.map((c) => c.file)).toEqual(["/repo/x/a.ts", "/repo/x/b.ts"]);
    expect(detail.items[3].description).toBe("1m");
    expect(detail.items[3].children?.map((c) => c.label)).toEqual(["three", "two"]);
  });
});

describe("actionsOf", () => {
  test("running here can move to a worktree, finished can resume, external claude cannot move", () => {
    expect(actionsOf(session({ status: "busy", terminal: "t1" }))).toContain("worktree");
    expect(actionsOf(session({ status: "busy" }))).not.toContain("worktree");
    expect(actionsOf(session({ status: "busy", tool: "codex" }))).toContain("worktree");
    expect(actionsOf(session({ status: "busy", terminal: "t1", worktree: "x" }))).not.toContain("worktree");
    expect(actionsOf(session({ status: "inactive" }))).toContain("resume");
    expect(actionsOf(session({ status: "done", terminal: "t1" }))).toContain("markSeen");
  });
});

describe("home", () => {
  test("resume list: finished sessions, newest first, searchable", () => {
    const rows = inactiveRows([
      session({ id: "old", status: "inactive", since: NOW - 9000, searchText: "old thing" }),
      session({ id: "new", status: "inactive", since: NOW - 1000, lastPrompt: "fix the login" }),
      session({ id: "b", status: "busy" }),
    ], NOW);
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
    expect(rows[0].lastPrompt).toBe("fix the login");
    expect(rows[1].search).toBe("old thing");
  });

  test("stats count activity by tool and worktrees per repo", () => {
    const day = 24 * 3_600_000;
    const T = 100 * day;
    const stats = buildStats([
      session({ repo: "a", tool: "claude", status: "busy", since: T - 1000, worktree: "x", root: "/a/x" }),
      session({ repo: "a", tool: "codex", status: "inactive", since: T - 3 * day }),
      session({ repo: "b", tool: "claude", status: "inactive", since: T - 30 * day }),
    ], T);
    expect(stats.today).toEqual({ claude: 1, codex: 0 });
    expect(stats.week).toEqual({ claude: 1, codex: 1 });
    expect(stats.running).toBe(1);
    expect(stats.repos.map((r) => [r.repo, r.worktrees, r.sessions])).toEqual([["a", 1, 2], ["b", 0, 1]]);
  });
});
