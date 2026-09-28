export interface Surface {
  title: string;
  viewed: boolean;
  terminal?: string;
}

/** Keyed by tty name (`ttys004`), the one thing a process and a terminal have in common. */
export type Surfaces = Map<string, Surface>;

export interface SourceOptions {
  surfaces: Surfaces;
  sinceMs: number;
}
