---
name: rcd-security
description: Use for Agent Port security-sensitive work involving auth, APP_PASSWORD, session cookies, Tailscale-only access posture, repo whitelist enforcement, branch/file path validation, git diff safety, PTY input boundaries, secrets handling, or remote access risk review.
---

# Agent Port Security

Use this skill when a change can affect access to local repositories or local Codex execution.

## Required Workflow

1. Read `AGENTS.md` first.
2. Analyze the request and identify the trust boundary.
3. Produce a short plan and wait for explicit user confirmation before edits.
4. Prefer narrow changes and verification over broad refactors.

## Security Invariants

- Server default bind stays `127.0.0.1`.
- Remote access is through Tailscale only.
- App-level password login remains enabled by default.
- `APP_PASSWORD` comes from `.env` or process env and is not committed or documented with real values.
- Browser never sends raw repo paths.
- Unknown repo keys are rejected.
- Git APIs stay read-only unless the user explicitly approves a product change.
- Git diff file paths must stay inside the whitelisted repo root.
- No arbitrary shell command execution is exposed.
- Remote input is allowed only for active `web_managed` sessions.
- Local-terminal sessions must reject remote input.

## Review Checklist

- Auth route behavior and session cookie settings.
- Repo key validation and path resolution.
- Branch name validation.
- Session/task id validation.
- Relative file path and path traversal handling.
- PTY input boundaries and close/kill behavior.
- Logs and events do not intentionally expose secrets.
- Limits and timeouts remain enforced.

## Validation

Use Bun commands only:

```sh
bun run typecheck
bun run test
```

Add or update focused tests for status transitions, validation, auth boundaries, or path safety when risk changes.
