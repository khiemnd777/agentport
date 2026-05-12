# Runbook

## Start Development

```sh
cd /Users/khiemnguyen/Works/agent_port/agent_port
bun install
bun run dev
```

Open:

```text
http://127.0.0.1:5177
```

## Start Separately

Backend:

```sh
bun run dev:server
```

Web:

```sh
bun run dev:web
```

## Production-Style Local Run

```sh
bun run build
bun run start
```

Open:

```text
http://127.0.0.1:8787
```

## Validation

```sh
bun run typecheck
bun run test
bun run build
```

The Vite chunk-size warning is currently non-fatal.

## Tailscale

Production-style single port:

```sh
tailscale serve --bg 8787
```

Dev UI:

```sh
tailscale serve --bg 5177
```

## Common Recovery

Check listeners:

```sh
lsof -nP -iTCP:8787 -sTCP:LISTEN
lsof -nP -iTCP:5177 -sTCP:LISTEN
```

Check auth config:

```sh
curl -sS http://127.0.0.1:8787/api/auth/me
```

Expected:

```json
{"authenticated":false,"requirePassword":true,"passwordConfigured":true}
```

Check repo whitelist after login:

```sh
curl -sS -c /tmp/rcd-cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"password":"<APP_PASSWORD>"}' \
  http://127.0.0.1:8787/api/auth/login

curl -sS -b /tmp/rcd-cookies.txt http://127.0.0.1:8787/api/repos
```

Do not paste real `APP_PASSWORD` into docs.
