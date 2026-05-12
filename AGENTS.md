# Agent Port Agent Notes

## Product

Agent Port is a private, self-hosted browser UI for controlling local Codex CLI sessions on a MacBook through Tailscale. It is production-like local software, not a throwaway task runner.

The browser terminal controls a separate local Codex CLI process spawned in a selected whitelisted repo. It does not share conversation context or active skills with the Codex Desktop app thread.

## Hard Rules

- Before implementing any request or task, analyze the request, produce a short plan, and ask the user to confirm. Do not start coding or editing files until the user confirms the plan.
- For UI-related work, include a text mockup before implementation. The mockup should show the intended layout, key labels, states, and interactions in plain text.
- Use Bun only.
- Use `bun install`, `bun run <script>`, and `bun test`.
- Do not use npm, yarn, or pnpm.
- Do not create `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.
- Keep secrets in `.env`; do not document real secret values.
- The server must default to localhost binding.
- Remote access is Tailscale-only.
- Do not expose arbitrary shell command execution from the browser.
- The browser must send repo keys only, never raw repo paths.
- Keep repo paths resolved through the backend whitelist in `config.json`.

## Architecture

- Root app: Bun workspace with `server/` and `web/`.
- Backend: Bun, TypeScript, Hono, Bun WebSocket, PTY session manager, file storage.
- Frontend: React, Vite, TypeScript, xterm.js.
- Storage: JSON/JSONL files under `data/`.
- Codex backend: local Codex CLI process spawned via PTY in the selected repo.
- PTY strategy: try `node-pty` first; fall back to macOS `/usr/bin/expect` bridge when Bun/node-pty spawn fails.

## Commands

```sh
bun install
bun run dev
bun run dev:server
bun run dev:web
bun run build
bun run typecheck
bun run test
```

Default dev ports:

- UI: `127.0.0.1:5177`
- Backend: `127.0.0.1:8787`

## Config And Runtime

- `.env` contains host, ports, config path, and `APP_PASSWORD`.
- `config.json` contains the repo whitelist and local Codex command.
- `config.json` is local and ignored by git.
- Current expected repo key is `noah`.
- Current repo path is `/Users/khiemnguyen/Works/project_noah/noah`.

## Session Lifecycle

- Active sidebar should stay clean.
- Stopped sessions are archived out of the default list according to `sessions.autoArchiveStoppedAfterMinutes`.
- Archived sessions are visible through the History view.
- Archived sessions are deleted after `sessions.deleteArchivedAfterDays` unless the value is `0`.
- `DISCONNECTED`, `CLOSED`, and `ERROR` are stopped terminal states.
- Active PTY processes do not survive backend restart; metadata, events, and logs remain.

## Task Lifecycle

- Terminal status and task status are separate.
- A PTY session can stay alive after a task completes.
- A session can run multiple tasks over time.
- `WAITING_FOR_USER` only applies to `web_managed` sessions/tasks.
- Task marker detection depends on explicit Codex output markers:
  - `[USER_INPUT_REQUIRED]`
  - `[TASK_COMPLETED]`
  - `[TASK_BLOCKED]`

## Security

- Keep app private by default.
- Use app-level password auth even behind Tailscale.
- Read `APP_PASSWORD` from `.env` or process env.
- Validate repo keys, branch names, session ids, task ids, and git diff file paths.
- Git APIs are read-only.
- Do not add commit, push, or destructive git operations without an explicit product decision.

## UI Product Notes

- For every UI change, start with a text mockup and get confirmation before writing code.
- The terminal is a live Codex CLI console, not a general-purpose shell.
- The Task composer is the preferred managed workflow surface.
- The terminal is an escape hatch for direct Codex CLI interaction.
- Make session identity and context boundaries explicit in UI copy.
- The Agent Port CLI session is independent from the Codex Desktop app conversation.
