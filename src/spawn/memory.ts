import type { Memento } from "vscode";
import type { Tool } from "../model/tools";

export interface Remembered {
  id: string;
  tool: Tool;
  cwd: string;
  reviewOf?: string;
}

const KEY = "agtc.windows";

/**
 * What ran in this window, for resume after a restart. VS Code has no window id that survives a
 * restart, so the list is keyed by the window's first folder: a window reopens with the folder it
 * had, and a folder swap moves its list along.
 */
export class WindowMemory {
  private last = "";

  constructor(private readonly memento: Memento) {}

  private all(): Record<string, Remembered[]> {
    return this.memento.get<Record<string, Remembered[]>>(KEY, {});
  }

  /** Written every poll, so unchanged lists skip the disk. */
  remember(folder: string, sessions: Remembered[]): Thenable<void> {
    const next = JSON.stringify([folder, sessions]);
    if (next === this.last) return Promise.resolve();
    this.last = next;
    return this.memento.update(KEY, { ...this.all(), [folder]: sessions });
  }

  /** Reads and clears, so a second window on the same folder does not resume the same agents. */
  take(folder: string): Thenable<Remembered[]> {
    const { [folder]: sessions = [], ...rest } = this.all();
    return this.memento.update(KEY, rest).then(() => sessions);
  }

  move(from: string, to: string): Thenable<void> {
    const { [from]: sessions = [], ...rest } = this.all();
    return this.memento.update(KEY, { ...rest, [to]: sessions });
  }
}
