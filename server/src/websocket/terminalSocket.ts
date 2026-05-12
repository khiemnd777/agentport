import type { AuthService } from "../auth/authService";
import { getAuthToken } from "../auth/sessionAuth";
import type { PtySessionManager } from "../pty/PtySessionManager";
import { validateSessionId } from "../utils/validation";

export interface TerminalSocketData {
  kind: "terminal";
  sessionId: string;
}

type TerminalWebSocket = Bun.ServerWebSocket<TerminalSocketData>;

export function tryUpgradeTerminalSocket(
  request: Request,
  server: Bun.Server<TerminalSocketData>,
  authService: AuthService
): Response | undefined {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/ws\/sessions\/([^/]+)\/terminal$/);
  if (!match) {
    return new Response("Not found", { status: 404 });
  }

  const token = getAuthToken(request.headers.get("cookie"));
  if (!authService.authenticate(token)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let sessionId: string;
  try {
    sessionId = validateSessionId(match[1]);
  } catch {
    return new Response("Invalid session id", { status: 400 });
  }

  const upgraded = server.upgrade(request, {
    data: { kind: "terminal", sessionId }
  });
  if (!upgraded) {
    return new Response("WebSocket upgrade failed", { status: 400 });
  }
  return undefined;
}

export function createTerminalSocketHandlers(manager: PtySessionManager): Bun.WebSocketHandler<TerminalSocketData> {
  return {
    open(ws) {
      void manager.attachClient(ws.data.sessionId, ws).catch((error) => {
        sendSocketError(ws, ws.data.sessionId, "ATTACH_FAILED", (error as Error).message);
        ws.close();
      });
    },
    message(ws: TerminalWebSocket, rawMessage: string | Buffer) {
      void handleMessage(manager, ws, rawMessage);
    },
    close(ws) {
      void manager.detachClient(ws.data.sessionId, ws);
    }
  };
}

async function handleMessage(
  manager: PtySessionManager,
  ws: TerminalWebSocket,
  rawMessage: string | Buffer
): Promise<void> {
  try {
    const message = JSON.parse(rawMessage.toString()) as Record<string, unknown>;
    if (message.type === "input") {
      if (message.sessionId !== ws.data.sessionId || typeof message.data !== "string") {
        return;
      }
      await manager.writeFromClient(ws.data.sessionId, message.data);
      return;
    }
    if (message.type === "resize") {
      if (message.sessionId !== ws.data.sessionId) {
        return;
      }
      const cols = typeof message.cols === "number" ? message.cols : 120;
      const rows = typeof message.rows === "number" ? message.rows : 40;
      manager.resize(ws.data.sessionId, cols, rows);
    }
  } catch (error) {
    sendSocketError(ws, ws.data.sessionId, "MESSAGE_FAILED", (error as Error).message);
  }
}

function sendSocketError(ws: TerminalWebSocket, sessionId: string, code: string, message: string): void {
  ws.send(JSON.stringify({ type: "error", sessionId, code, message }));
}
