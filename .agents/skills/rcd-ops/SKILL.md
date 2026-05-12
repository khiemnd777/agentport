---
name: rcd-ops
description: Use for Agent Port local operations involving Bun scripts, .env, config.json, host/port settings, DRY environment variables, local startup, Tailscale Serve setup, process troubleshooting, build/typecheck/test procedures, or runbook updates.
---

# Agent Port Ops

Use this skill for local run, configuration, and deployment workflow changes.

## Required Workflow

1. Read `AGENTS.md` first.
2. Analyze the requested operational change.
3. Produce a short plan and wait for explicit user confirmation before edits.

## Operational Rules

- Use Bun only.
- Keep `.env` as the source for local host, ports, config path, and `APP_PASSWORD`.
- Avoid duplicated env values when one value can derive from another.
- Do not document real secret values.
- Keep `config.example.json` generic and `config.json` local.
- Do not add Docker unless the user explicitly asks.
- Do not add public internet exposure.
- Tailscale Serve is the supported remote access path.

## Useful Commands

```sh
bun install
bun run dev
bun run dev:server
bun run dev:web
bun run typecheck
bun run test
bun run build
```

## Troubleshooting Focus

- Confirm server and UI ports match `.env`.
- Confirm `APP_PASSWORD` is loaded by direct server starts and root dev scripts.
- Confirm `config.json` repo paths exist.
- Confirm the Codex CLI command is available in the environment used by the backend.
- If a PTY fails under Bun, verify the expect fallback before changing packages.
