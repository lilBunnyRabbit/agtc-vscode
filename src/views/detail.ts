import { EventEmitter, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri, type Command, type Event, type TreeDataProvider } from "vscode";
import { join } from "node:path";
import { collapse, plural, tildify } from "../lib/text";
import { relativeAge } from "../lib/time";
import { type Session, workDir } from "../model/session";
import { HOME } from "../paths";

interface DetailNode {
  label: string;
  description?: string;
  icon?: string;
  tooltip?: string;
  command?: Command;
  children?: DetailNode[];
}

const PROMPT_WIDTH = 100;

export class DetailProvider implements TreeDataProvider<DetailNode> {
  private readonly changed = new EventEmitter<DetailNode | undefined>();
  readonly onDidChangeTreeData: Event<DetailNode | undefined> = this.changed.event;
  private nodes: DetailNode[] = [];

  show(session: Session | undefined): void {
    this.nodes = session ? detailNodes(session) : [];
    this.changed.fire(undefined);
  }

  getChildren(node?: DetailNode): DetailNode[] {
    return node ? (node.children ?? []) : this.nodes;
  }

  getTreeItem(node: DetailNode): TreeItem {
    const item = new TreeItem(node.label, node.children?.length ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None);
    item.description = node.description;
    item.tooltip = node.tooltip ?? node.label;
    if (node.icon) item.iconPath = new ThemeIcon(node.icon);
    item.command = node.command;
    return item;
  }
}

function detailNodes(session: Session): DetailNode[] {
  const now = Date.now();
  const dir = workDir(session);
  const nodes: DetailNode[] = [{ label: tildify(dir, HOME), icon: "folder", description: session.worktree ? `worktree ${session.worktree}` : undefined }];
  if (session.branch) nodes.push({ label: session.branch, icon: "git-branch" });
  if (session.roots.length > 1) {
    nodes.push({ label: "also touched", icon: "references", children: session.roots.slice(1).map((root) => ({ label: tildify(root, HOME), icon: "folder" })) });
  }
  if (session.changes) nodes.push(changesNode(session, dir));
  if (session.waitingFor) nodes.push({ label: session.waitingFor, icon: "bell-dot" });
  if (session.verdict) nodes.push({ label: session.verdict.text, icon: session.verdict.ready ? "pass" : "error" });
  if (session.lastPrompt) {
    const earlier = session.prompts.slice(0, -1).slice(-2).reverse();
    nodes.push({
      label: collapse(session.lastPrompt, PROMPT_WIDTH),
      icon: "comment",
      description: session.lastPromptAt ? relativeAge(session.lastPromptAt, now) : undefined,
      tooltip: session.lastPrompt,
      children: earlier.map((prompt) => ({ label: collapse(prompt, PROMPT_WIDTH), icon: "comment-discussion", tooltip: prompt })),
    });
  }
  if (session.subagents?.length) {
    nodes.push({
      label: plural(session.subagents.length, "subagent", "subagents"),
      icon: "type-hierarchy-sub",
      children: session.subagents.map((agent) => ({
        label: collapse(agent.description, PROMPT_WIDTH),
        description: [agent.kind, agent.status, relativeAge(agent.since, now)].filter(Boolean).join(" · "),
        icon: agent.status === "busy" ? "sync~spin" : "check",
      })),
    });
  }
  return nodes;
}

function changesNode(session: Session, dir: string): DetailNode {
  const { paths, insertions, deletions, base, ahead } = session.changes!;
  const summary = paths.length ? `${plural(paths.length, "file", "files")} +${insertions} −${deletions}` : "clean";
  const description = base && ahead !== undefined ? `${ahead} ahead of ${base}` : undefined;
  return {
    label: summary,
    description,
    icon: "diff",
    children: paths.map((path) => ({
      label: path,
      icon: "file",
      command: { command: "agtc.openDiff", title: "Open Diff", arguments: [join(dir, path)] },
    })),
  };
}

export function headDiffUris(file: string): [Uri, Uri] {
  const uri = Uri.file(file);
  return [uri.with({ scheme: "git", query: JSON.stringify({ path: file, ref: "HEAD" }) }), uri];
}
