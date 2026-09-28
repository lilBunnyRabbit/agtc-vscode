import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { startCommand, worktreeDir, writeTask } from "../src/spawn/task";

describe("spawn", () => {
  test("worktree dir under the repo, slashes become pluses, absolute config wins", () => {
    expect(worktreeDir("/r", "feat/x")).toBe("/r/.claude/worktrees/feat+x");
    expect(worktreeDir("/r", "x", "/wt")).toBe("/wt/x");
    expect(worktreeDir("/r", "x", "trees")).toBe("/r/trees/x");
  });

  test("task goes through a file, plain start without one", () => {
    const path = writeTask("  do the thing\n", 1);
    expect(readFileSync(path, "utf8")).toBe("do the thing\n");
    expect(startCommand("claude", path)).toBe(`claude "$(cat '${path}')"`);
    expect(startCommand("codex")).toBe("codex");
  });
});
