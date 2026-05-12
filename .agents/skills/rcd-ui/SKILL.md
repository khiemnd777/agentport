---
name: rcd-ui
description: Use for Agent Port frontend or UX work involving React, Vite, xterm.js, responsive desktop/mobile layouts, the session sidebar, Codex terminal, task composer, follow-up input, git diff panel, status badges, login flow, or UI copy.
---

# Agent Port UI

Use this skill for browser UI changes.

## Required Workflow

1. Read `AGENTS.md` first.
2. Analyze the request and produce a short plan.
3. Provide a text mockup before any UI implementation.
4. Wait for explicit user confirmation before editing files.

## Text Mockup Requirements

For UI changes, show:

- Intended layout for desktop and mobile if both are affected.
- Key labels, buttons, tabs, badges, and empty/error/loading states.
- Primary interaction flow.
- Any copy that clarifies that the browser terminal controls a separate local Codex CLI process.

## Product Rules

- The app is a production-like self-hosted browser desktop, not a throwaway MVP.
- Console should remain the main mobile view.
- Controls must be touch-friendly on iPhone Safari.
- The terminal is for controlling the spawned Codex CLI session, not a generic shell.
- The task composer is the preferred managed workflow surface.
- Make session context, repo, branch, terminal status, and task status visible.
- Avoid decorative UI that reduces operational density.

## Implementation Notes

- Frontend code lives under `web/src`.
- Use React + Vite + TypeScript.
- Use xterm.js for the terminal.
- Keep API access through `web/src/api`.
- Keep session, task, git, and layout components separated.

## Validation

Use Bun commands only:

```sh
bun run typecheck
bun run test
bun run build
```

For meaningful UI changes, also verify the running UI in a browser when practical.
