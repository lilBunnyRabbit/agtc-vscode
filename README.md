# agtc-vscode

Agent Traffic Control for VS Code: every Claude Code and Codex session on the machine in the sidebar, grouped by repo, with status, checkout, changes and last prompt. The VS Code counterpart of [agtc](https://github.com/lilBunnyRabbit/agtc). Plan and milestones in `docs/plan.md`.

## Keys

`⌘⌥J` / `⌘⌥K` next / previous session running in this window, `⌘⌥1`…`9` the session with that digit, `⌘⌥N` the session that has waited longest, `⌘⌥A` the sidebar, `⌘⌥T` the home page: composer (agent, checkout, worktree switch, task, `⌘⏎` starts), the sessions that need you, every session with its action buttons. The same buttons sit under the sidebar detail. Clicking a row brings its terminal to the front and makes its checkout the window's folder. `⇗` marks a session running outside this window.

In the sidebar: `n` new agent in a checkout of the row's repo, `N` new agent in a new worktree, `W` move the running session into a new worktree (Claude does it through `EnterWorktree`; a Codex row gets a fresh Codex in the worktree with its last prompt), `R` resume a finished session, `t` the composer, `m` / `M` seen, `c` copy the resume command, `o` open the checkout in a new window, `a` show inactive.

Agents that ran in a window come back when it reopens (`agtc.resumeOnStartup`). Worktrees go under `.claude/worktrees` of the repo (`agtc.worktreeDir`), branched from the remote default (`agtc.baseBranch`). `agtc.terminalLocation: editor` gives agents a full tab.

## Develop

```
bun install
```

F5 ("Run Extension") builds and opens a VS Code window with the extension loaded from `out/`, no debugger. Same as `bun run dev`. After a change: `bun run build`, then `Developer: Reload Window` in that window. "Debug Extension" is the real extension host debugger; on a machine where `localhost` resolves to `::1` first it times out with "Extension host did not start in 10 seconds", the inspector listens on IPv4 only. `bun run check` typechecks, `bun test` runs the pure parts.

## Install

```
bun run package
code --install-extension agtc-0.1.0.vsix
```

`code` comes from the Command Palette, "Shell Command: Install 'code' command in PATH".
