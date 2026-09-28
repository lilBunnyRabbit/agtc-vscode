import type { Memento } from "vscode";
import type { Tool } from "../model/tools";

export interface Remembered {
  id: string;
  tool: Tool;
  cwd: string;
  reviewOf?: string;
}

const KEY = "agtc.windows";
const SWAP_KEY = "agtc.swappedAt";
const SWAP_WINDOW_MS = 60_000;

/**
 * What ran in this window, for resume after a restart. VS Code has no window id that survives a
 * restart, so the list is keyed by the window's first folder: the placeholder directory a window
 * gets on its first switch, its own folder before that.
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

  /** The window's first folder is about to change, which restarts the extension host: the list follows, and the flag tells the next activation it is not a window start. */
  move(from: string, to: string): Thenable<void> {
    const { [from]: sessions = [], ...rest } = this.all();
    return this.memento.update(SWAP_KEY, Date.now()).then(() => this.memento.update(KEY, { ...rest, [to]: sessions }));
  }

  afterSwap(): Thenable<boolean> {
    const at = this.memento.get<number>(SWAP_KEY, 0);
    return this.memento.update(SWAP_KEY, undefined).then(() => Date.now() - at < SWAP_WINDOW_MS);
  }
}
