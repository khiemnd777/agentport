---
name: rcd-review
description: Use for production-readiness review of Agent Port changes, especially regressions in task/session lifecycle, PTY/WebSocket behavior, auth boundaries, repo whitelist safety, git diff read-only behavior, mobile/desktop UX, Bun scripts, docs, and validation coverage.
---

# Agent Port Review

Use this skill for review or final sign-off.

## Review Stance

Lead with findings ordered by severity. Focus on:

- Bugs and behavioral regressions.
- Security boundary breaks.
- Missing validation or tests.
- Session/task lifecycle drift.
- UI states that mislead the user about what is controlled.
- Bun command or docs drift.

Avoid style-only comments unless they hide a real maintainability or correctness risk.

## Required Checks

- Terminal status and task status remain separate.
- Stopped sessions do not pollute the active sidebar.
- Archived/history behavior is intentional.
- `WAITING_FOR_USER` only applies to `web_managed`.
- Remote input is disabled outside active web-managed sessions.
- Repo paths cannot be supplied by the browser.
- Git status/diff APIs are read-only and path-safe.
- UI copy makes the separate Codex CLI context clear.
- README and docs use Bun commands only.

## Validation

Report exactly what was run and what was not run. Prefer:

```sh
bun run typecheck
bun run test
bun run build
```

For UI changes, include browser verification when practical.
