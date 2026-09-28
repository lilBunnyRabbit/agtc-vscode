# agtc-vscode

Agent Traffic Control for VS Code: every Claude Code and Codex session on the machine in the sidebar, grouped by repo, with status, checkout, changes and last prompt. The VS Code counterpart of [agtc](https://github.com/lilBunnyRabbit/agtc). Plan and milestones in `docs/plan.md`.

## Keys

`⌘⌥J` / `⌘⌥K` next / previous session running in this window, `⌘⌥1`…`9` the session with that digit, `⌘⌥N` the session that has waited longest, `⌘⌥A` the sidebar. Clicking a row brings its terminal to the front and makes its checkout the window's folder. `⇗` marks a session running outside this window.

## Develop

```
bun install
```

F5 in VS Code runs the extension in an Extension Development Host with esbuild watching; `⌘R` there reloads it after a change. `bun run check` typechecks, `bun test` runs the pure parts.

## Install

```
bun run package
code --install-extension agtc-0.1.0.vsix
```

`code` comes from the Command Palette, "Shell Command: Install 'code' command in PATH".
