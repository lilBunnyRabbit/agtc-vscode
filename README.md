# agtc-vscode

Agent Traffic Control for VS Code: every Claude Code and Codex session on the machine in the sidebar, grouped by repo, with status, checkout, changes and last prompt. The VS Code counterpart of [agtc](https://github.com/lilBunnyRabbit/agtc). Plan and milestones in `docs/plan.md`.

## Agents run in tmux

Every agent runs in a window of the tmux session `agtc`, the same one the agtc hub uses. The editor has one terminal, "agents": a tmux client on a session of its own, grouped with `agtc`, so it keeps its own current window while the hub or another editor window looks elsewhere. Selecting a session shows its tmux window in that terminal. Closing the terminal or the editor ends no agent. Needs `tmux` on the PATH.

## Keys

`⌘⌥J` / `⌘⌥K` next / previous running session, `⌘⌥1`…`9` the session with that digit, `⌘⌥N` the session that has waited longest, `⌘⌥A` the sidebar, `⌘⌥T` the home page: composer (agent, checkout, worktree switch, task, `⌘⏎` starts), the sessions that need you, every session with its action buttons. The same buttons sit under the sidebar detail. Clicking a row brings its terminal to the front and makes its checkout the window's folder, so quick open, search, Explorer and source control see that checkout alone. The window's first folder is an empty placeholder named `agtc` that never changes: changing the first folder restarts every extension and cuts running agents off from the editor. The first switch in a window puts the placeholder in, which restarts once and replaces the folder the window was opened with. `⇗` marks a session running outside tmux.

In the sidebar: `n` new agent in a checkout of the row's repo, `N` new agent in a new worktree, `W` move the running session into a new worktree (Claude does it through `EnterWorktree`; a Codex row gets a fresh Codex in the worktree with its last prompt), `R` resume a finished session, `t` the composer, `m` / `M` seen, `c` copy the resume command, `o` open the checkout in a new window, `a` show inactive.

## Review

`V` on a session (or `⌘⌥V`, or the review button) starts the loop. The spec is a file, `~/.cache/agtc/specs/<session id>.md`: ask the author to write it, write it yourself in a tab, or take a prompt as it is. With the file there, review starts a second agent read-only in a tmux pane split beside the author's, the other tool by default (`agtc.reviewer`). Its row hangs under the author's and shows the verdict when its turn ends.

Findings the report names as `path:line` become comment threads on those lines in the author's checkout; the rest and the questions land in one thread on the spec file. Each thread has "send to agent", which puts that finding into the author's input unsent, and "dismiss". `V` on the reviewer row hands the whole report back the same way. `x` closes the reviewer, its threads go with it.

A toast shows when a session turns to needs input or done while its terminal is not in front, gone after `agtc.notificationSeconds`.

## Search, attachments, sessions elsewhere

`⌘⌥/` (or `/` in the sidebar) searches every prompt of every session, finished ones included. Enter jumps to a running session and resumes a finished one.

"Attach files…" in the composer copies the files into the checkout's `.agtc/attachments/` and names them in the task. The folder is excluded through the repository's `info/exclude`, no tracked file changes.

A session marked `⇗` runs outside tmux. "bring here" ends that process and resumes the session in a tmux window; it waits for the process to exit first and refuses while a turn is running. With `agtc.pullRequests` on, the detail shows the pull request of the selected session's branch, read through `gh`.

## Worktrees

"Clean Up Worktrees" (command palette, or the link under a session's detail) lists the repository's worktrees with their state: `fresh` never committed to, `gone` upstream deleted after a merge, `missing` directory gone, `pushed`, `unpushed`, `dirty`, `detached`. Live and locked ones are left out. The safe ones, `fresh`, `gone` and `missing`, come ticked. One confirm removes what is ticked; ticking one that holds work nowhere else says so in the confirm. `gone` and `fresh` lose their branch too, every other branch stays. The detail of a session in a worktree shows that worktree's state.

Worktrees go under `.claude/worktrees` of the repo (`agtc.worktreeDir`), branched from the remote default (`agtc.baseBranch`). `agtc.terminalLocation: editor` gives agents a full tab.

## Develop

```
bun install
```

F5 ("Run Extension") builds and opens a VS Code window with the extension loaded from `out/`, no debugger. Same as `bun run dev`. After a change: `bun run build`, then `Developer: Reload Window` in that window. "Debug Extension" is the real extension host debugger; on a machine where `localhost` resolves to `::1` first it times out with "Extension host did not start in 10 seconds", the inspector listens on IPv4 only. `bun run check` typechecks, `bun test` runs the pure parts.

## Install

```
bun run install:local
```

Packages the extension and installs it into VS Code, replacing the installed version. Then `Developer: Reload Window` in every open window. To remove it: `code --uninstall-extension lilbunnyrabbit.agtc`.
