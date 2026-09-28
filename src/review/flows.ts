import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Uri, ViewColumn, env, window, workspace } from "vscode";
import { collapse } from "../lib/text";
import { type Session, type Tool, isTool, workDir } from "../model/session";
import type { StateStore } from "../model/state-store";
import { reviewerFor } from "../model/tools";
import { baseBranch, checkoutName } from "../sources/git";
import { killPane, pasteIntoPane } from "../tmux/tmux";
import { reviewerCommand, writeReviewPrompt } from "./prompt";
import { reportMessage, reviewerReport } from "./report";
import { resolveSpec, specPath, specRequest } from "./spec";

export interface ReviewContext {
  sessions: Session[];
  state: StateStore;
  refresh(): Promise<void>;
  launch(dir: string, command: string, name: string, beside?: string): Promise<string | undefined>;
  show(pane: string): Promise<boolean>;
}

const say = (text: string): void => void window.setStatusBarMessage(`agtc: ${text}`, 5000);
const short = (session: Session) => collapse(session.title, 40);

/**
 * `V`: a second agent reads the session's work against its spec and reports, read-only. Its
 * process is fresh, so the author's reasoning never reaches it; the other tool by default, so
 * not even memory does. The spec is a file in a tab: what is saved there is what the reviewer gets.
 */
export async function startReview(ctx: ReviewContext, session: Session): Promise<void> {
  if (session.reviewOf) return handBack(ctx, session);
  const running = ctx.sessions.find((s) => s.reviewOf === session.id && s.status !== "inactive");
  if (running) return say(`${running.tool} is still reviewing this: close it first`);
  const dir = workDir(session);
  if (!existsSync(dir)) return say("the checkout is gone");

  const path = specPath(session.id);
  const REVIEW = "review against the spec file";
  const ASK = `ask ${session.tool} to write the spec`;
  const WRITE = "write the spec myself";
  const EDIT = "open the spec to edit";
  const prompts = [session.firstPrompt, session.lastPrompt].filter((p): p is string => !!p && !p.startsWith("/"));
  const choices = existsSync(path) ? [REVIEW, EDIT, ASK] : [ASK, WRITE, ...[...new Set(prompts)].map((p) => `use: ${collapse(p, 100)}`)];
  const picked = await window.showQuickPick(choices, { placeHolder: `spec for "${short(session)}"` });
  if (!picked) return;
  if (picked === ASK) return requestSpec(ctx, session, path);
  if (picked === EDIT) return openSpec(path);
  if (picked === WRITE) {
    writeSpec(path, `# Spec\n\n${session.firstPrompt ?? ""}\n`);
    await openSpec(path);
    return say("save the spec, then review again");
  }
  if (picked !== REVIEW) writeSpec(path, `${prompts.find((p) => `use: ${collapse(p, 100)}` === picked) ?? ""}\n`);

  await workspace.textDocuments.find((d) => d.uri.fsPath === path && d.isDirty)?.save();
  const spec = resolveSpec(path);
  if (!spec) return say("the spec file is empty");
  const tool = await reviewerTool(session);
  if (tool) await launchReviewer(ctx, session, dir, spec, tool);
}

function writeSpec(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

async function openSpec(path: string): Promise<void> {
  await window.showTextDocument(Uri.file(path), { viewColumn: ViewColumn.Beside, preview: false });
}

async function reviewerTool(session: Session): Promise<Tool | undefined> {
  const configured = workspace.getConfiguration("agtc").get<string>("reviewer", "other");
  if (isTool(configured)) return configured;
  return reviewerFor(session.tool);
}

/** The author knows what was built: the request lands in its input, you send it, review again once the file exists. */
async function requestSpec(ctx: ReviewContext, session: Session, path: string): Promise<void> {
  const where = await handTo(ctx, session, specRequest(path));
  if (where === "terminal") say(`spec request is in "${short(session)}": send it there, then review again`);
  else say(session.status === "inactive" ? "spec request copied: resume the session, paste it there" : "spec request copied: the session runs outside tmux, paste it there");
}

async function launchReviewer(ctx: ReviewContext, session: Session, dir: string, spec: string, tool: Tool): Promise<void> {
  const id = randomUUID();
  const base = session.changes?.base ?? (await baseBranch(dir));
  const promptPath = writeReviewPrompt(id, { spec, base });
  const pane = await ctx.launch(dir, reviewerCommand(tool, id, promptPath), `${await checkoutName(dir)} review`, session.pane);
  ctx.state.rememberReview({ id: tool === "claude" ? id : undefined, pane: pane ?? "", of: session.id, at: Date.now() });
  say(`started ${tool} to review "${short(session)}"`);
}

/** `x`: only reviewers, nothing else started here is read-only. */
export function closeReviewer(ctx: ReviewContext, session: Session): void {
  if (!session.reviewOf) return say("close is for reviewers only: quit other agents in their terminal");
  if (session.status === "inactive") return say("not running");
  if (!session.pane) return say("runs outside tmux: quit it where it runs");
  if (session.status === "done") return say("unread report: hand it back or mark it seen, then close");
  void killPane(session.pane).then((closed) => {
    say(closed ? `closed ${session.tool} reviewer` : `tmux pane ${session.pane} not found`);
    if (closed) void ctx.refresh();
  });
}

/** Text into a session's input, unsent. One the paste cannot reach gets it on the clipboard. */
export async function handTo(ctx: ReviewContext, session: Session, text: string): Promise<"terminal" | "clipboard"> {
  const pane = session.status === "inactive" ? undefined : session.pane;
  if (!pane || !(await pasteIntoPane(pane, text))) {
    await env.clipboard.writeText(text);
    return "clipboard";
  }
  await ctx.show(pane);
  return "terminal";
}

export async function handBack(ctx: ReviewContext, reviewer: Session): Promise<void> {
  const subject = ctx.sessions.find((s) => s.id === reviewer.reviewOf);
  if (!subject) return say("the reviewed session is not in the list");
  if (reviewer.status === "busy") return say("reviewer still working");
  if (reviewer.status === "needs input") return say("reviewer is waiting on you: answer it first");
  const report = reviewerReport(reviewer);
  if (!report) return say("no report yet: the reviewer has not finished a turn");
  ctx.state.mark(reviewer.id);
  const where = await handTo(ctx, subject, reportMessage(reviewer, report));
  if (where === "terminal") say(`report is in "${short(subject)}": read it, then send`);
  else say(subject.status === "inactive" ? "report copied: resume the session, then paste" : `report copied: "${short(subject)}" runs outside tmux`);
  void ctx.refresh();
}
