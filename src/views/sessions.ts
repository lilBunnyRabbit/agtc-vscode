import { EventEmitter, MarkdownString, TreeItem, TreeItemCollapsibleState, type Event, type TreeDataProvider } from "vscode";
import { tildify } from "../lib/text";
import type { Session } from "../model/session";
import { HOME } from "../paths";
import { repoDescription, sessionDescription, sessionLabel, statusIcon } from "./format";

export interface RepoNode {
  kind: "repo";
  repo: string;
  sessions: Session[];
}

export interface SessionNode {
  kind: "session";
  session: Session;
  underSubject: boolean;
}

export type Node = RepoNode | SessionNode;

export class SessionsProvider implements TreeDataProvider<Node> {
  private readonly changed = new EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData: Event<Node | undefined> = this.changed.event;
  private sessions: Session[] = [];
  private repos: RepoNode[] = [];
  showInactive = false;

  set(sessions: Session[]): void {
    this.sessions = sessions;
    this.rebuild();
  }

  toggleInactive(): void {
    this.showInactive = !this.showInactive;
    this.rebuild();
  }

  byId(id: string): Session | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  nodeOf(id: string): SessionNode | undefined {
    for (const repo of this.repos) {
      const index = repo.sessions.findIndex((s) => s.id === id);
      if (index >= 0) return this.sessionNode(repo.sessions, index);
    }
    return undefined;
  }

  private rebuild(): void {
    const listed = this.showInactive ? this.sessions : this.sessions.filter((s) => s.status !== "inactive");
    const byRepo = new Map<string, Session[]>();
    for (const session of listed) byRepo.set(session.repo, [...(byRepo.get(session.repo) ?? []), session]);
    this.repos = [...byRepo].map(([repo, sessions]) => ({ kind: "repo", repo, sessions }));
    this.changed.fire(undefined);
  }

  private sessionNode(sessions: Session[], index: number): SessionNode {
    const session = sessions[index];
    const underSubject = !!session.reviewOf && sessions.some((s) => s.id === session.reviewOf);
    return { kind: "session", session, underSubject };
  }

  getChildren(node?: Node): Node[] {
    if (!node) return this.repos;
    if (node.kind === "repo") return node.sessions.map((_, i) => this.sessionNode(node.sessions, i));
    return [];
  }

  getParent(node: Node): Node | undefined {
    if (node.kind === "repo") return undefined;
    return this.repos.find((r) => r.sessions.includes(node.session));
  }

  getTreeItem(node: Node): TreeItem {
    if (node.kind === "repo") {
      const item = new TreeItem(node.repo, TreeItemCollapsibleState.Expanded);
      item.id = `repo:${node.repo}`;
      item.description = repoDescription(node.sessions);
      item.contextValue = "repo";
      return item;
    }
    const { session, underSubject } = node;
    const item = new TreeItem(sessionLabel(session, underSubject), TreeItemCollapsibleState.None);
    item.id = session.id;
    item.description = sessionDescription(session);
    item.iconPath = statusIcon(session.status);
    item.contextValue = "session";
    item.tooltip = tooltip(session);
    return item;
  }
}

function tooltip(session: Session): MarkdownString {
  const lines = [`**${session.title}**`, "", `${session.tool} · ${session.status}`, tildify(session.root ?? session.cwd, HOME)];
  if (session.waitingFor) lines.push(`waiting for: ${session.waitingFor}`);
  if (session.verdict) lines.push(`verdict: ${session.verdict.text}`);
  if (session.lastPrompt) lines.push("", session.lastPrompt);
  const md = new MarkdownString(lines.join("\n\n"));
  md.supportThemeIcons = true;
  return md;
}
