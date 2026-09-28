import { join } from "node:path";
import { collapse, plural, tildify } from "../lib/text";
import { DAY, relativeAge } from "../lib/time";
import { type Session, type Status, workDir } from "../model/session";
import { HOME } from "../paths";

export interface Row {
  id: string;
  digit?: number;
  tool: Session["tool"];
  worktree: boolean;
  title: string;
  status: Status;
  age: string;
  branch?: string;
  verdict?: { ready: boolean; text: string };
  external: boolean;
  review: boolean;
  waitingFor?: string;
  actions: Action[];
  repo: string;
  lastPrompt?: string;
  search: string;
}

export type Action = "jump" | "worktree" | "resume" | "new" | "newWorktree" | "copyResume" | "openFolder" | "markSeen";

export const ACTION_LABEL: Record<Action, string> = {
  jump: "jump",
  worktree: "move to worktree",
  resume: "resume",
  new: "new agent here",
  newWorktree: "new worktree",
  copyResume: "copy resume",
  openFolder: "open in new window",
  markSeen: "seen",
};

export const ACTION_COMMAND: Record<Action, string> = {
  jump: "agtc.jump",
  worktree: "agtc.moveToWorktree",
  resume: "agtc.resume",
  new: "agtc.new",
  newWorktree: "agtc.newWorktree",
  copyResume: "agtc.copyResume",
  openFolder: "agtc.openFolder",
  markSeen: "agtc.markSeen",
};

export function actionsOf(session: Session): Action[] {
  const inactive = session.status === "inactive";
  const actions: Action[] = ["jump"];
  if (inactive) actions.push("resume");
  else if (session.mainRoot && !session.worktree && (session.terminal || session.tool === "codex")) actions.push("worktree");
  if (!inactive && (session.status === "needs input" || session.status === "done")) actions.push("markSeen");
  actions.push("new", "newWorktree", "copyResume", "openFolder");
  return actions;
}

export interface Group {
  repo: string;
  description: string;
  rows: Row[];
}

export interface DetailItem {
  icon: string;
  label: string;
  description?: string;
  tooltip?: string;
  file?: string;
  children?: DetailItem[];
}

export interface Detail {
  id: string;
  title: string;
  items: DetailItem[];
}

export interface ViewState {
  groups: Group[];
  detail?: Detail;
  selectedId?: string;
  showInactive: boolean;
  actions: Record<Action, { label: string; command: string }>;
}

export interface RepoStat {
  repo: string;
  sessions: number;
  running: number;
  waiting: number;
  worktrees: number;
}

export interface Stats {
  today: Record<Session["tool"], number>;
  week: Record<Session["tool"], number>;
  running: number;
  repos: RepoStat[];
}

export interface HomeState {
  inactive: Row[];
  stats: Stats;
  checkouts: string[];
  actions: ViewState["actions"];
}

/** Activity by last touch: a session counts for the day and week it was last active in. */
export function buildStats(sessions: Session[], now = Date.now()): Stats {
  const count = (sinceMs: number) => {
    const active = sessions.filter((s) => Math.max(s.since, s.lastPromptAt ?? 0) >= now - sinceMs);
    return { claude: active.filter((s) => s.tool === "claude").length, codex: active.filter((s) => s.tool === "codex").length };
  };
  const byRepo = new Map<string, Session[]>();
  for (const s of sessions) byRepo.set(s.repo, [...(byRepo.get(s.repo) ?? []), s]);
  const repos = [...byRepo]
    .map(([repo, list]) => ({
      repo,
      sessions: list.length,
      running: list.filter((s) => s.status !== "inactive").length,
      waiting: list.filter((s) => s.status === "needs input" || s.status === "done").length,
      worktrees: new Set(list.filter((s) => s.worktree).map((s) => s.root)).size,
    }))
    .sort((a, b) => b.running - a.running || b.sessions - a.sessions);
  return { today: count(DAY), week: count(7 * DAY), running: sessions.filter((s) => s.status !== "inactive").length, repos };
}

/** Finished sessions, the most recently active first. */
export function inactiveRows(sessions: Session[], now = Date.now()): Row[] {
  return sessions
    .filter((s) => s.status === "inactive")
    .sort((a, b) => b.since - a.since)
    .map((s) => rowOf(s, sessions, undefined, now));
}

export const actionTable = (): ViewState["actions"] =>
  Object.fromEntries((Object.keys(ACTION_LABEL) as Action[]).map((a) => [a, { label: ACTION_LABEL[a], command: ACTION_COMMAND[a] }])) as ViewState["actions"];

const MAX_DIGIT = 9;
const PROMPT_WIDTH = 160;

export function digitsOf(sessions: Session[]): Map<string, number> {
  return new Map(
    sessions
      .filter((s) => s.terminal && s.status !== "inactive")
      .slice(0, MAX_DIGIT)
      .map((s, i) => [s.id, i + 1]),
  );
}

export function buildGroups(sessions: Session[], showInactive: boolean, now = Date.now()): Group[] {
  const digits = digitsOf(sessions);
  const listed = showInactive ? sessions : sessions.filter((s) => s.status !== "inactive");
  const byRepo = new Map<string, Session[]>();
  for (const session of listed) byRepo.set(session.repo, [...(byRepo.get(session.repo) ?? []), session]);
  return [...byRepo].map(([repo, group]) => ({
    repo,
    description: repoDescription(group),
    rows: group.map((session) => rowOf(session, group, digits.get(session.id), now)),
  }));
}

function rowOf(session: Session, group: Session[], digit: number | undefined, now: number): Row {
  return {
    id: session.id,
    digit,
    tool: session.tool,
    worktree: !!session.worktree,
    title: session.title,
    status: session.status,
    age: relativeAge(session.since, now),
    branch: session.branch,
    verdict: session.verdict,
    external: !session.terminal && session.status !== "inactive",
    review: !!session.reviewOf && group.some((s) => s.id === session.reviewOf),
    waitingFor: session.waitingFor,
    actions: actionsOf(session),
    repo: session.repo,
    lastPrompt: session.lastPrompt ? collapse(session.lastPrompt, PROMPT_WIDTH) : undefined,
    search: session.searchText,
  };
}

export function repoDescription(sessions: Session[]): string {
  const waiting = sessions.filter((s) => s.status === "needs input").length;
  const done = sessions.filter((s) => s.status === "done").length;
  const parts = [];
  if (waiting) parts.push(`${waiting} input`);
  if (done) parts.push(`${done} done`);
  parts.push(plural(sessions.length, "session", "sessions"));
  return parts.join(" · ");
}

export function buildDetail(session: Session, now = Date.now()): Detail {
  const dir = workDir(session);
  const items: DetailItem[] = [{ icon: "folder", label: tildify(dir, HOME), description: session.worktree ? `worktree ${session.worktree}` : undefined }];
  if (session.branch) items.push({ icon: "branch", label: session.branch });
  if (session.roots.length > 1) {
    items.push({ icon: "roots", label: "also touched", children: session.roots.slice(1).map((root) => ({ icon: "folder", label: tildify(root, HOME) })) });
  }
  if (session.changes) items.push(changesItem(session, dir));
  if (session.waitingFor) items.push({ icon: "wait", label: session.waitingFor });
  if (session.verdict) items.push({ icon: session.verdict.ready ? "ready" : "notready", label: session.verdict.text });
  if (session.lastPrompt) {
    const earlier = session.prompts.slice(0, -1).slice(-2).reverse();
    items.push({
      icon: "prompt",
      label: collapse(session.lastPrompt, PROMPT_WIDTH),
      description: session.lastPromptAt ? relativeAge(session.lastPromptAt, now) : undefined,
      tooltip: session.lastPrompt,
      children: earlier.map((prompt) => ({ icon: "prompt", label: collapse(prompt, PROMPT_WIDTH), tooltip: prompt })),
    });
  }
  if (session.subagents?.length) {
    items.push({
      icon: "agents",
      label: plural(session.subagents.length, "subagent", "subagents"),
      children: session.subagents.map((agent) => ({
        icon: agent.status === "busy" ? "busy" : "done",
        label: collapse(agent.description, PROMPT_WIDTH),
        description: [agent.kind, agent.status, relativeAge(agent.since, now)].filter(Boolean).join(" · "),
      })),
    });
  }
  return { id: session.id, title: session.title, items };
}

function changesItem(session: Session, dir: string): DetailItem {
  const { paths, insertions, deletions, base, ahead } = session.changes!;
  const summary = paths.length ? `${plural(paths.length, "file", "files")} +${insertions} −${deletions}` : "clean";
  const description = base && ahead !== undefined ? `${ahead} ahead of ${base}` : undefined;
  return { icon: "diff", label: summary, description, children: paths.map((path) => ({ icon: "file", label: path, file: join(dir, path) })) };
}
