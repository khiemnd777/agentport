# Project Memory

These are human-authored project notes, not official Codex memory files.

Official Codex memories are generated state under the Codex home directory, normally `~/.codex/memories/`.

## Product Decisions

- Product name: Agent Port.
- Product target: production-like self-hosted remote Codex control surface for local MacBook use through Tailscale.
- Do not treat the app as a simple one-shot task runner.
- Do not expose the app publicly.
- Do not require Codex Cloud.
- Execution backend is local Codex CLI.
- Workflow rule: every implementation request must start with analysis, a short plan, and explicit user confirmation before code edits.
- UI workflow rule: every UI-related request must include a text mockup before implementation.

## Important Context Boundary

The chat workspace projects the local Codex thread store through Codex app-server. Agent Port prefers the running Codex Desktop app-server proxy and falls back to a standalone stdio app-server, so Codex Desktop and Agent Port can continue the same thread when it is idle.

The browser terminal controls a new/separate Codex CLI session. It does not inherit:

- Codex Desktop app conversation history.
- Active skills from the current Codex Desktop thread.
- Thread-specific memory or tool state.

Same cwd does not imply same Codex context.

When Codex Desktop owns an active turn, Agent Port should observe and sync transcript state but should not answer approvals, user-input requests, or interrupts for that Desktop-owned turn.

## Runtime Decisions

- Use Bun everywhere.
- `node-pty` may fail under Bun/macOS with `posix_spawnp failed`.
- Keep the `/usr/bin/expect` PTY fallback.
- Force PTY env to `TERM=xterm-256color` and `COLORTERM=truecolor`.
- Backend should load app-root `.env` defensively so direct launches still see `APP_PASSWORD`.

## UX Decisions

- UI changes require a text mockup before implementation.
- Primary sidebar shows active, non-archived sessions.
- History is explicit through a sidebar view toggle.
- Stopped sessions archive out of Active according to retention config.
- Terminal input is disabled for non-live sessions.
- Terminal should replay recent persisted logs when attaching.
- Task composer is the managed remote workflow; terminal is direct Codex CLI control.

## Security Decisions

- App-level password auth is required.
- Keep real password only in `.env`.
- Browser never sends raw repo paths.
- Browser must not expose arbitrary shell commands.
- Git status/diff only; no commit/push/destructive operations.
- Validate file paths against repo root for diff APIs.

## Current Local Defaults

- UI dev port: `5177`.
- Backend port: `8787`.
- Current repo key: `noah`.
- Current repo path: `/Users/khiemnguyen/Works/project_noah/noah`.
- Tailscale Serve should target `8787` for production-style serving or `5177` for dev UI.
