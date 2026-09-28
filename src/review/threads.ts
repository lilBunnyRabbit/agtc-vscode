import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { type CommentController, CommentMode, type CommentThread, MarkdownString, Range, Uri, comments } from "vscode";
import { type Session, workDir } from "../model/session";
import { type Finding, findingMessage, parseReport } from "./findings";
import { reviewerReport } from "./report";
import { specPath } from "./spec";

export interface ThreadFinding {
  reviewerId: string;
  subjectId: string;
  message: string;
}

/**
 * A reviewer's findings as comment threads on the lines they name, in the subject's checkout.
 * Threads live as long as their reviewer runs; a finished turn replaces them with the new report's.
 */
export class ReviewThreads {
  private readonly controller: CommentController = comments.createCommentController("agtc.review", "agtc review");
  private readonly shown = new Map<string, { at: number; threads: CommentThread[] }>();
  private readonly findings = new WeakMap<CommentThread, ThreadFinding>();

  sync(sessions: Session[]): void {
    const live = new Set<string>();
    for (const reviewer of sessions) {
      if (!reviewer.reviewOf || reviewer.status === "inactive") continue;
      live.add(reviewer.id);
      if (reviewer.status === "busy" || reviewer.status === "needs input") continue;
      if (this.shown.get(reviewer.id)?.at === reviewer.since) continue;
      const subject = sessions.find((s) => s.id === reviewer.reviewOf);
      const report = subject && reviewerReport(reviewer);
      this.drop(reviewer.id);
      this.shown.set(reviewer.id, { at: reviewer.since, threads: report ? this.create(reviewer, subject, report) : [] });
    }
    for (const id of [...this.shown.keys()]) if (!live.has(id)) this.forget(id);
  }

  findingOf(thread: CommentThread): ThreadFinding | undefined {
    return this.findings.get(thread);
  }

  dismiss(thread: CommentThread): void {
    thread.dispose();
  }

  dispose(): void {
    for (const id of [...this.shown.keys()]) this.forget(id);
    this.controller.dispose();
  }

  private drop(reviewerId: string): void {
    for (const thread of this.shown.get(reviewerId)?.threads ?? []) thread.dispose();
  }

  private forget(reviewerId: string): void {
    this.drop(reviewerId);
    this.shown.delete(reviewerId);
  }

  private create(reviewer: Session, subject: Session, report: string): CommentThread[] {
    const { findings, questions } = parseReport(report);
    const root = workDir(subject);
    const threads: CommentThread[] = [];
    const loose: string[] = [];
    for (const finding of findings) {
      const file = finding.path && (isAbsolute(finding.path) ? finding.path : join(root, finding.path));
      if (!file || !existsSync(file)) {
        loose.push(`- ${finding.path ? `\`${finding.path}:${finding.line}\` ` : ""}${finding.text}`);
        continue;
      }
      threads.push(this.thread(Uri.file(file), (finding.line ?? 1) - 1, body(finding), reviewer, subject, findingMessage(finding, reviewer.tool)));
    }
    const spec = specPath(subject.id);
    if ((loose.length || questions.length) && existsSync(spec)) {
      const text = [loose.length ? `**Findings without a place**\n\n${loose.join("\n")}` : "", questions.length ? `**Questions**\n\n${questions.map((q) => `- ${q}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
      threads.push(this.thread(Uri.file(spec), 0, text, reviewer, subject, `From a ${reviewer.tool} reviewer that saw only the spec and the diff:\n\n${text}\n`));
    }
    return threads;
  }

  private thread(uri: Uri, line: number, text: string, reviewer: Session, subject: Session, message: string): CommentThread {
    const thread = this.controller.createCommentThread(uri, new Range(line, 0, line, 0), [
      { body: new MarkdownString(text), mode: CommentMode.Preview, author: { name: `${reviewer.tool} reviewer` } },
    ]);
    thread.canReply = false;
    thread.label = "agtc review";
    thread.contextValue = "agtc.finding";
    this.findings.set(thread, { reviewerId: reviewer.id, subjectId: subject.id, message });
    return thread;
  }
}

const body = (finding: Finding) => `${finding.severity ? `**${finding.severity}** · ` : ""}${finding.text}`;
