import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CODEX_DIR } from "../../paths";

export interface CodexThread {
  id: string;
  cwd: string;
  git_branch: string | null;
  title: string;
  first_user_message: string;
  rollout_path: string;
  updated_at: number;
}

const STATE_DB = /^state_(\d+)\.sqlite$/;

/** Codex keeps one state DB per schema version; the highest number is current. */
function currentStateDb(): string | undefined {
  if (!existsSync(CODEX_DIR)) return undefined;
  const version = (file: string) => Number(file.match(STATE_DB)?.[1] ?? -1);
  const newest = readdirSync(CODEX_DIR)
    .filter((file) => STATE_DB.test(file))
    .sort((a, b) => version(b) - version(a))[0];
  return newest ? join(CODEX_DIR, newest) : undefined;
}

function query<T>(sql: string, ...params: string[]): T[] {
  const path = currentStateDb();
  if (!path) return [];
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return db.prepare(sql).all(...params) as T[];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export function readCodexThreads(): CodexThread[] {
  return query<CodexThread>(
    "select id, cwd, git_branch, title, first_user_message, rollout_path, updated_at from threads where archived = 0 order by updated_at desc",
  );
}

export interface SpawnedThread {
  id: string;
  title: string;
  rollout_path: string;
  agent_nickname: string | null;
  agent_role: string | null;
  agent_path: string | null;
}

/** Threads spawned by `parentId`. Older state DBs have no spawn table: none then. */
export function readSpawnedThreads(parentId: string): SpawnedThread[] {
  return query<SpawnedThread>(
    `select t.id, t.title, t.rollout_path, t.agent_nickname, t.agent_role, t.agent_path
     from thread_spawn_edges e join threads t on t.id = e.child_thread_id
     where e.parent_thread_id = ?`,
    parentId,
  );
}
