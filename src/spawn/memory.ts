import type { Memento } from "vscode";

const SWAP_KEY = "agtc.swappedAt";
const LAUNCH_KEY = "agtc.pendingLaunch";

export interface Launch {
  dir: string;
  command: string;
  name: string;
}
const SWAP_WINDOW_MS = 60_000;

/** What has to survive the one restart a window's first switch causes. Agents themselves live in tmux and need no memory. */
export class WindowMemory {
  constructor(private readonly memento: Memento) {}

  /** The window's first folder is about to change, which restarts the extension host; the flag tells the next activation it is not a window start. */
  willRestart(): Thenable<void> {
    return this.memento.update(SWAP_KEY, Date.now());
  }

  /** A launch that has to wait for the restart the first switch of a window causes. */
  defer(launch: Launch): Thenable<void> {
    return this.memento.update(LAUNCH_KEY, { ...launch, at: Date.now() });
  }

  takeDeferred(): Thenable<Launch | undefined> {
    const launch = this.memento.get<Launch & { at: number }>(LAUNCH_KEY);
    return this.memento.update(LAUNCH_KEY, undefined).then(() => (launch && Date.now() - launch.at < SWAP_WINDOW_MS ? launch : undefined));
  }

  afterSwap(): Thenable<boolean> {
    const at = this.memento.get<number>(SWAP_KEY, 0);
    return this.memento.update(SWAP_KEY, undefined).then(() => Date.now() - at < SWAP_WINDOW_MS);
  }
}
