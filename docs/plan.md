# agtc-vscode

> Superseded in two places on 2026-09-28. Agents run in tmux, not in VS Code terminals: a session tied to the editor died with it and the terminal list grew with every agent. The window never swaps its first folder: that restarts every extension and cuts agents off from the editor; a placeholder stays first and the session's checkout is the second folder. README has the current behaviour.

Plan for the VS Code extension. Written 2026-09-28 from the decisions below, so the build can start
cold in a new repo. References: this repo (session model, sources, review loop, worktrees) and
[agent-deck](https://github.com/anzemur/agent-deck) (terminal linking, folder switching, restart
resume, task composer, notifications). Both are read for ideas and copied from where it saves time;
neither is a dependency.

## Decisions

- Full extension. Agents run in VS Code integrated terminals. On restart every session that ran in
  the window is `claude --resume`d / `codex resume`d in its checkout. A turn that was busy at quit
  is lost; accepted.
- Sidebar lists every session on the machine, Claude Code and Codex, grouped by repo. Sessions not
  in this window's terminals are marked external. They can be jumped to (folder opens, terminal is
  not ours) and brought here (ended there, resumed in a terminal here, agent-deck's move).
- Keyboard first, the hub's keys as chords. Home page webview for starting sessions and for stats.
- Clicking a session focuses its terminal and opens its checkout in this window.
- Worktrees: spawn first, decide later is the default. `W` moves a running session into a fresh
  worktree. `N` creates one up front. Cleanup with the `fresh` / `gone` / `unpushed` rules. Task
  composer on the home page.
- Review loop kept, moved into the editor: findings as inline comment threads, verdict on the row.
- New repo `agtc-vscode`, TypeScript, copies what it needs from agtc. No shared package. agtc's
  hub keeps working untouched; no new features there.
- VS Code only. Never Cursor.

## Not building

- Terminal emulation or a chat UI. The agent's own TUI runs in the terminal.
- tmux. Nothing in the extension knows about it. Sessions running in tmux elsewhere show as
  external like any other app.
- The graph. Home page stats cover the overview.
- Network. `gh` for PR state is the one exception and is opt-in; everything else reads disk and
  processes, as agtc.

## Architecture

Single extension host process, no separate server. Poll every 2 s while a sidebar or home page is
visible, 10 s otherwise, plus a watcher on `~/.claude/projects` and Codex's sessions dir for
faster state changes.

```
src/
  model/        session types, tools, collect, sort, search, verdict   copied from agtc/src/model
  sources/      claude/, codex/, git, processes                        copied from agtc/src/sources
  link/         terminal <-> session: pid tree of each integrated terminal, lsof cwd, session id
  review/       spec, prompt, report parse, comment threads
  worktrees/    state, add, remove, cleanup rules                      copied from agtc/src/worktrees
  views/        sessions tree, detail (tree children or webview), home webview
  commands/     jump, new, worktree, review, resume, search, cleanup
  notify/       badge, status bar, toast
  state/        per-window memento: terminal ids, session ids, seen marks, review links
  extension.ts
```

Copy, do not import: agtc's `src/model`, `src/sources`, `src/review/{spec,prompt,report}`,
`src/worktrees/{state,read}` have no TUI or tmux dependency and come over mostly as is.
`src/sources/terminal.ts` (Terminal.app tabs) and `src/tmux` do not come over. Tests copy with
the code; `bun test` stays the test runner for the pure parts, `@vscode/test-electron` for the
integration suite, agent-deck's `test/run.sh` is the pattern.

### Linking terminals to sessions

The same problem agent-deck and agtc's `processes.ts` solve. Per integrated terminal:
`terminal.processId` → child pids → a `claude` or `codex` process → its cwd via `lsof` → the
session id from the newest transcript in that cwd's project dir with that pid (Claude writes the
pid in the transcript's first lines; Codex's rollout name carries the thread id). Done on every
poll; cached by pid. A terminal with no agent is a plain shell and shows under its folder as
"shell".

A session whose cwd moved (`EnterWorktree`, `--worktree`) is linked by where it edits, as agtc
does: the checkout of its most recent file edit wins over the shell's cwd. That is what makes
"spawn first, decide later" show up on the row without any action.

### Folder switching

Clicking a session opens its checkout as the window's folder. Implementation:
`workspace.updateWorkspaceFolders` replacing the current root set with the session's checkout,
agent-deck's way. Keeps terminals (they belong to the window, not the folder). Option
`agtc.keepOtherFolders` leaves other roots open and only adds. Tabs from a folder that is no
longer open close if clean, stay if dirty.

## Sidebar

Tree view `agtc.sessions` in its own activity bar container. Rows mirror the hub:

```
acme-platform                                   1 done · 4 sessions
  1  ✳  done       Settings page safe padding              2m
  2  ✳ ⎇ busy      Sidebar header overflow on iOS          5m
       ⬡  idle     ╰ review · ready                        1m
       ⬡  idle ⇗   Can the chart legend be restyled        1h   (external)
```

- Status colour and description as the hub. Digit in the label for running sessions in this
  window; external ones have none.
- Order fixed: repos alphabetically, live sessions in start order, finished newest first. A
  status change never moves a row.
- Selecting a row shows the detail: checkout, branch, uncommitted files (click opens a diff
  against HEAD), commits ahead, last prompts. Detail is a second tree view in the same
  container, collapsible, so it is keyboard reachable; a webview only if the tree cannot show it.
- Context menu per row: jump, open folder in new window, review (V), hand back, close, resume,
  copy resume command, move to worktree (W), mark seen.
- Toggle: show inactive.

## Home page

Webview tab, opened by the activity bar header button or on startup (setting). Sections:

1. Composer. Tool picker (Claude / Codex), repo picker (repos seen in the last 30 days plus the
   open folders), checkout picker defaulting to the repo's main checkout, worktree switch off by
   default. Task text, multi-line, attachments dropped in are saved under the checkout's
   `.agtc/attachments/` (git-ignored) and referenced in the prompt. Enter starts the agent in a
   new terminal with the task passed through a file (long prompts do not survive a shell line).
   With the worktree switch on, a branch name is proposed from the task and the worktree created
   first, agent-deck's flow, as the non-default path.
2. Needs you. Sessions in `input` and `done`, oldest first, click jumps.
3. Stats. Sessions started today and this week per tool, busy time per repo (from transcript
   timestamps), worktrees per repo with how many are removable, reviews run and verdict split.
   Read-only, computed from the same data the sidebar has.

## Keys

Chords, default `cmd+alt`, all work with a terminal focused (`when` includes `terminalFocus`):

| chord | action |
|---|---|
| `⌘⌥J` / `⌘⌥K` | next / previous running session, wrapping |
| `⌘⌥1`…`9` | the session with that digit |
| `⌘⌥A` | back to the sidebar (the hub's `option-a`) |
| `⌘⌥N` | oldest session that needs you |
| `⌘⌥T` | home page composer |
| `⌘⌥V` | review the selected session / hand the report back on a reviewer |
| `⌘⌥/` | search across every prompt (quick pick) |

Inside the tree: `enter` jump, `o` open folder in new window, `v` diff, `V` review, `x` close,
`n` new agent here, `N` new worktree, `W` move to worktree, `R` resume, `m` / `M` seen, `a`
inactive, `c` copy resume, `?` reference. Tree views take single keys through
`keybindings` with `when: focusedView == agtc.sessions`.

## Flows

**Spawn first, decide later.** `n` on any row of the repo, or the composer with the worktree
switch off. Agent starts in the main checkout. Investigate. When the work turns into a change,
`W`: asks for a branch name, sends the session one line asking it to enter a worktree with that
name via `EnterWorktree` and continue. Next poll the row shows `⎇` and the branch, the folder
follows on the next jump. Codex has no such tool: `W` on a Codex row creates the worktree and
starts a fresh Codex there with the last prompt, the old session stays.

**Worktree up front.** `N` or the composer switch. Branch name, `git worktree add` under
`<repo>/.claude/worktrees/`, setup hook, agent in it.

**Bring an external session here.** Row shows ⇗. Click "bring here": the extension asks the
other app's process to exit (SIGTERM to the agent, as agent-deck), waits for its transcript to
close, resumes it in a terminal in its checkout. Busy sessions queue until idle.

**Restart.** On activation, every session id in the window memento that has no live process is
resumed in a terminal in its last checkout, with the same read-only flags if it was a reviewer.
Setting `agtc.resumeOnStartup`, default on.

**Cleanup.** Command "Clean up worktrees" lists the repo's worktrees with agtc's states
(`fresh`, `gone`, `unpushed`, `dirty`, `missing`, `live`), removable ones pre-checked in a quick
pick, one confirm, remove. `gone` and `fresh` delete the branch. A row whose worktree is
removable shows it in the detail.

## Review loop in the editor

Same loop, three things the editor does better than a terminal.

1. **Spec is a file in a tab.** `V` first time asks the session to write the spec to
   `~/.cache/agtc/specs/<session id>.md` as today, then opens it in a tab beside the terminal.
   Edit, save, `V` again picks the reviewer tool. The spec is read from the file at launch, so
   what you saved is what the reviewer gets.
2. **Findings become comment threads.** The reviewer prompt already asks for numbered
   `path:line` references. When the reviewer's turn completes the report is parsed: each finding
   with a reference becomes a VS Code comment thread on that line, in the subject's checkout,
   via the Comments API (the same UI GitHub PR review comments use). Unreferenced findings and
   the questions go in one thread on the spec file. The verdict lands on the reviewer's row,
   `ready` / `not ready`, with its first line in the detail and in the toast.
3. **Hand back per finding or all.** Each thread has two actions: "send to agent" pastes that
   finding into the subject's terminal unsent, "dismiss" resolves it. The row action `V` on the
   reviewer sends the whole report as today. Threads disappear when the reviewer is closed with
   `x` or when the file at that line changes and the thread's text no longer matches.

The reviewer runs read-only (Claude with writing tools disallowed, Codex read-only sandbox) in a
terminal split beside the subject's, `terminalLocation: editor` gives both a full tab. Its row
hangs off the subject's row.

Not in the first version: a native base-branch diff for the reviewer's file list. `v` on a row
opens the checkout's changed files as `HEAD` diffs one by one, which the built-in SCM already
gives; the reviewer's view of base vs branch waits until the comment threads have been used.

## Notifications

- Badge on the activity bar icon with the count of `input` + `done`, cleared by looking.
- Status bar item `✳ 2 waiting`, click jumps to the oldest.
- Toast when a session turns `input` or `done` while its terminal is not visible, auto-dismiss
  after `agtc.notificationSeconds` (default 12, 0 keeps it), one button: jump.
- No macOS banner in the first version. agent-deck's helper app route is there if VS Code being
  in the background turns out to matter.

## Settings

| setting | default | |
|---|---|---|
| `agtc.days` | 7 | how far back inactive sessions are listed |
| `agtc.resumeOnStartup` | true | |
| `agtc.showOnStartup` | true | sidebar and home page on window open |
| `agtc.terminalLocation` | `panel` | `editor` for full-size agent tabs |
| `agtc.keepOtherFolders` | false | add the session's folder instead of replacing |
| `agtc.baseBranch` | `""` | new worktrees branch from here, empty is the remote default |
| `agtc.worktreeDir` | `.claude/worktrees` | relative to the repo |
| `agtc.reviewer` | `other` | `other`, `claude`, `codex` |
| `agtc.notificationSeconds` | 12 | |
| `agtc.pullRequests` | false | ask `gh` for PR state per branch (network) |
| `agtc.editor.setupCommand` | `""` | run in every new worktree, `.agtc/config.json` `setup` wins |

## Milestones

Each ships alone and is usable.

1. **List.** Copy model and sources, sessions tree with status and detail, poll, external mark.
   No terminals of ours yet. Proves the copy runs inside the extension host (Bun-only APIs
   like `bun:sqlite` for Codex need a Node replacement, `better-sqlite3` or `node:sqlite`).
2. **Link and jump.** Terminals linked to sessions, click focuses terminal and switches folder,
   chords, digits, badge and status bar.
3. **Spawn.** `n`, `N`, `W`, composer without attachments, restart resume, memento state.
4. **Review.** Spec tab, reviewer split, verdict on row, comment threads, hand back.
5. **Worktrees.** States, cleanup command, removable mark in detail.
6. **Home.** Composer with attachments, needs-you list, stats. Search quick pick.
7. **External.** Bring here, PR state behind the setting.

## Open questions

- Codex source uses `bun:sqlite`. The extension host is Node; pick `node:sqlite` (Node 22, check
  VS Code's bundled version) or shell out to `sqlite3`. Decide in milestone 1.
- Claude's pid in the transcript: verify the field name and that it survives `--resume`; agtc's
  `processes.ts` matches by cwd and start time today, which is enough as a fallback.
- Digits: per window or per machine? Per window is stable and matches the terminals you can
  actually reach; external sessions get none.
- Folder replace and the TS server: agent-deck reports it as fine with
  `closeOtherWorktreeTabs`; measure on the platform repo before making replace the default.
