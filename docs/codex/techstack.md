# Tech Stack

## Runtime

- Package manager: Bun only.
- Language: TypeScript.
- Root workspace: `server/` and `web/`.

## Backend

- Runtime: Bun.
- HTTP framework: Hono.
- WebSocket: Bun WebSocket server.
- PTY: `node-pty` first, macOS `/usr/bin/expect` fallback.
- Storage: file-based JSON/JSONL under `data/`.
- Auth: local password session auth with `APP_PASSWORD`.
- Git: read-only status and diff APIs.

## Frontend

- React.
- Vite.
- TypeScript.
- xterm.js for terminal rendering.
- Mobile-first responsive layout.

## Local Ports

- Backend: `127.0.0.1:8787`
- Web dev UI: `127.0.0.1:5177`

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

## Config Files

- `.env`: local env values. Ignored by git.
- `.env.example`: safe template.
- `config.json`: real local repo whitelist. Ignored by git.
- `config.example.json`: safe template.

The backend defensively loads app-root `.env`; scripts also use Bun `--env-file`.

## Current Local Repo Whitelist

Expected active key:

```text
noah -> /Users/khiemnguyen/Works/project_noah/noah
```

Browser clients send `repo_key` only. The backend resolves paths.
