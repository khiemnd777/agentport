# Agent Port

Agent Port is a self-hosted browser UI for running local Codex CLI sessions on a MacBook from another device over a private Tailscale network.

It exists for the at-home MacBook workflow: keep repositories and Codex running locally, then connect from iPhone, iPad, or another laptop through Tailscale to create sessions, submit tasks, watch live output, answer follow-up questions, and inspect read-only git changes.

## Architecture

```text
iPhone / iPad / Laptop
  -> Tailscale private network
  -> MacBook 127.0.0.1:8787
  -> Agent Port web app
  -> Hono API + Bun WebSocket server
  -> PTY Session Manager
  -> local Codex CLI process
  -> whitelisted local repositories
```

Core pieces:

- `web/`: React, Vite, TypeScript, xterm.js browser UI.
- `server/`: Bun, TypeScript, Hono REST API, WebSocket terminal bridge, PTY manager.
- `data/`: file-based storage for sessions, tasks, events, and terminal logs.
- `config.json`: repo whitelist and local runtime settings.

## Setup

Install dependencies with Bun:

```sh
cd agent_port
bun install
```

Create local config:

```sh
cp config.example.json config.json
cp .env.example .env
```

Edit `config.json` so each repo key points at a real local repository on the MacBook. The browser only sends `repo_key`; raw repo paths are resolved on the backend from this whitelist.
Set `repoDiscovery.searchRoots` to the local parent directories Agent Port may scan when the UI resolves a browser-selected folder name into a MacBook path.

Edit `.env` for local hosts, ports, config path, and password:

```dotenv
RCD_SERVER_HOST=127.0.0.1
RCD_SERVER_PORT=8787
RCD_WEB_HOST=127.0.0.1
RCD_WEB_PORT=5177
RCD_CONFIG_PATH=../config.json
RCD_REPO_SEARCH_ROOTS=/Users/khiem/projects
RCD_REPO_SEARCH_MAX_DEPTH=4
APP_PASSWORD=choose-a-strong-local-password
```

The Bun package scripts load `.env` automatically with `--env-file=../.env` for `server/` and `web/`. The backend also loads the app-root `.env` defensively at startup, so direct server launches still pick up `APP_PASSWORD`. Vite derives its HTTP and WebSocket proxy targets from `RCD_SERVER_HOST` and `RCD_SERVER_PORT`, so server location is configured in one place.

Codex CLI must already be installed and available as `codex` on the MacBook. If your command is different, update `codex.command` in `config.json`.

`node-pty` is tried first for interactive terminal behavior. On this Bun/macOS runtime, `node-pty` can fail at spawn time with `posix_spawnp failed`; when that happens the server automatically falls back to the built-in macOS `/usr/bin/expect` PTY bridge. The fallback still runs Codex in a PTY and streams browser input/output through Bun.

## Run Locally

Development mode, two local ports:

```sh
bun run dev
```

Open:

```text
http://127.0.0.1:5177
```

Run backend and web separately:

```sh
bun run dev:server
bun run dev:web
```

Production-style single-port serving:

```sh
bun run build
bun run start
```

Open:

```text
http://127.0.0.1:8787
```

Useful validation commands:

```sh
bun run typecheck
bun run build
bun run test
```

## Tailscale Serve

Install Tailscale on the MacBook and on the iPhone, iPad, or laptop. Log both devices into the same tailnet.

Run the app on the MacBook, then expose only to the tailnet:

```sh
tailscale serve --bg 8787
```

For dev UI through Tailscale, expose the Vite port instead:

```sh
tailscale serve --bg 5177
```

Open the HTTPS URL provided by Tailscale from the remote device. Do not expose this app to the public internet.

## Push Notifications

Agent Port supports Web Push alerts for task lifecycle events. On iPhone and iPad, this requires the HTTPS Tailscale URL and the Agent Port web app opened from the Home Screen.

Generate VAPID keys locally:

```sh
bun run push:vapid
```

Add the generated values to `.env` and restart the server:

```dotenv
RCD_PUSH_VAPID_PUBLIC_KEY=generated-public-key
RCD_PUSH_VAPID_PRIVATE_KEY=generated-private-key
RCD_PUSH_VAPID_SUBJECT=mailto:you@example.com
```

Keep the private key in `.env` only. After restart, open Agent Port on the device, use the Bell button, and enable notifications. Alerts are sent when a task completes, fails, or needs user input.

## Using The App

1. Sign in with `APP_PASSWORD`.
2. Pick a whitelisted repository.
3. Create a session. The backend spawns `codex` in that repo through a PTY.
4. Use the console for direct interactive terminal control.
5. Send a task from the task panel. The backend wraps the prompt with Agent Port instructions.
6. Watch the lifecycle timeline and git changes panel.
7. Close the session when finished.

## Session Lifecycle

The primary sidebar is production-style: it shows active, non-archived sessions only. Finished sessions are retained as history but removed from the default list by the retention policy.

Configure lifecycle behavior in `config.json`:

```json
"sessions": {
  "autoArchiveStoppedAfterMinutes": 1440,
  "deleteArchivedAfterDays": 0
}
```

- `autoArchiveStoppedAfterMinutes`: moves `DISCONNECTED`, `CLOSED`, and `ERROR` sessions out of the default sidebar after the configured age. `0` archives immediately.
- `deleteArchivedAfterDays`: permanently deletes archived session metadata, logs, events, and tasks after the configured age. `0` disables automatic deletion.
- `codex.taskTimeoutMinutes`: closes an idle live Codex PTY after the configured minutes. `0` disables the idle timeout, so sessions stay live until explicitly closed or until the backend/Codex process exits.

Use the sidebar toggle to switch between active sessions and history. Ended sessions can also be archived or deleted explicitly from the sidebar.

## WAITING_FOR_USER

Remote-managed tasks use explicit Codex markers:

- `[USER_INPUT_REQUIRED] <question>` moves a web-managed task to `WAITING_FOR_USER`.
- `[TASK_COMPLETED]` moves the task to `COMPLETED`.
- `[TASK_BLOCKED] <reason>` moves the task to `FAILED`.

When the task is `WAITING_FOR_USER`, the UI shows a follow-up input. Submitting an answer writes it back to the same Codex PTY and returns the task to `RUNNING`.

## Terminal State vs Task State

Terminal status tracks the PTY process:

- `CONNECTING`
- `CONNECTED`
- `RUNNING`
- `CLOSED`
- `ERROR`

Task status tracks the remote-managed agent lifecycle:

- `IDLE`
- `CREATED`
- `RUNNING`
- `WAITING_FOR_USER`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

A terminal can remain alive after a task completes, and a session can run multiple tasks over time.

## Web Managed vs Local Terminal

Web-created sessions use `control_mode: "web_managed"`. Only web-managed tasks may enter `WAITING_FOR_USER`, because the browser needs to show a clear answer box.

Future imported local terminal sessions should use `control_mode: "local_terminal"`. Those sessions may record that Codex requested input, but remote input is disabled and `WAITING_FOR_USER` is not entered.

## Security Notes

- Server bind defaults to `127.0.0.1`.
- Use Tailscale Serve for private tailnet access only.
- `APP_PASSWORD` is required when `auth.requirePassword` is true.
- Repositories must be whitelisted in `config.json`.
- The browser never sends raw repo paths.
- Unknown `repo_key` values are rejected.
- The UI does not expose arbitrary shell command execution.
- Git status and diff APIs are read-only.
- Git diff file paths are validated against repo root.
- Active sessions and tasks are limited by config.
- Terminal logs and events are stored locally under `data/`.
- Auth sessions are stored locally under `data/auth/` as token hashes and expire with the browser cookie.

## Current Limitations

- Active PTY processes do not survive a server restart; metadata, events, and logs do.
- Branch creation or checkout is not implemented yet.
- Task cancel records cancellation but does not yet provide a full workflow playback viewer.
- Git operations are read-only; commit, push, and branch management are intentionally out of scope.
- Changing `APP_PASSWORD` invalidates existing auth sessions.
