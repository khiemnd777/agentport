import type { AuthService } from "../auth/authService";
import type { PtySessionManager } from "../pty/PtySessionManager";
import { ChatSocketBroadcaster, tryUpgradeChatSocket, type ChatSocketData } from "./chatSocket";
import {
  createTerminalSocketHandlers,
  tryUpgradeTerminalSocket,
  type TerminalSocketData
} from "./terminalSocket";

export type RemoteSocketData = TerminalSocketData | ChatSocketData;

export function tryUpgradeRemoteSocket(
  request: Request,
  server: Bun.Server<RemoteSocketData>,
  authService: AuthService
): Response | undefined {
  const url = new URL(request.url);
  if (/^\/ws\/sessions\/[^/]+\/terminal$/.test(url.pathname)) {
    return tryUpgradeTerminalSocket(request, server as Bun.Server<TerminalSocketData>, authService);
  }
  if (/^\/ws\/sessions\/[^/]+\/chat$/.test(url.pathname)) {
    return tryUpgradeChatSocket(request, server as Bun.Server<ChatSocketData>, authService);
  }
  return new Response("Not found", { status: 404 });
}

export function createRemoteSocketHandlers(
  ptySessionManager: PtySessionManager,
  chatBroadcaster: ChatSocketBroadcaster
): Bun.WebSocketHandler<RemoteSocketData> {
  const terminalHandlers = createTerminalSocketHandlers(ptySessionManager);
  return {
    open(ws) {
      if (ws.data.kind === "chat") {
        chatBroadcaster.attach(ws.data.sessionId, ws as Bun.ServerWebSocket<ChatSocketData>);
        return;
      }
      terminalHandlers.open?.(ws as Bun.ServerWebSocket<TerminalSocketData>);
    },
    message(ws, message) {
      if (ws.data.kind === "chat") {
        return;
      }
      terminalHandlers.message?.(ws as Bun.ServerWebSocket<TerminalSocketData>, message);
    },
    close(ws, code, reason) {
      if (ws.data.kind === "chat") {
        chatBroadcaster.detach(ws.data.sessionId, ws as Bun.ServerWebSocket<ChatSocketData>);
        return;
      }
      terminalHandlers.close?.(ws as Bun.ServerWebSocket<TerminalSocketData>, code, reason);
    }
  };
}
