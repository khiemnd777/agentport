---
name: rcd-runtime
description: Use for Agent Port backend/runtime work involving the Bun server, Hono API routes, PTY session manager, WebSocket terminal transport, session/task/event/log storage, task marker detection, lifecycle rules, and local Codex CLI execution. Do not use for visual UI planning unless paired with rcd-ui.
---

# Agent Port Runtime

Use this skill when changing or reviewing the backend runtime that controls local Codex CLI sessions.

## Required Workflow

1. Read `AGENTS.md` first.
2. Analyze the request and produce a short plan before edits.
3. Do not edit files until the user has confirmed the plan.
4. If UI behavior is involved, pair with `rcd-ui` and include a text mockup before implementation.

## Runtime Boundaries

- Use Bun-only commands and scripts.
- Keep browser inputs limited to repo keys, branch names, prompts, active terminal input, resize events, and task follow-up text.
- Never add arbitrary shell command execution from the browser.
- Resolve repo paths only through `config.json` whitelist entries.
- Keep terminal status and task status separate.
- `WAITING_FOR_USER` is valid only for `web_managed` sessions/tasks.
- A PTY session may stay alive after a task completes.

## Implementation Notes

- Backend code lives under `server/src`.
- Session/task/event/log persistence uses file storage under `data/`.
- PTY flow is owned by `CodexPtySession` and `PtySessionManager`.
- WebSocket terminal behavior is owned by `websocket/terminalSocket.ts`.
- Task prompt wrapping and marker detection should remain centralized.
- Preserve the node-pty first, `/usr/bin/expect` fallback behavior unless replacing it with a tested more stable PTY path.

## Validation

Use Bun commands only:

```sh
bun run typecheck
bun run test
bun run build
```

Run the narrowest relevant validation first, then broaden when lifecycle, route, or storage behavior changes.
