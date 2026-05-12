import type { AuthService } from "../auth/authService";
import { getAuthToken } from "../auth/sessionAuth";
import type { ChatMessage } from "../domain/chatTypes";
import type { PublicCodexSession } from "../domain/sessionTypes";
import { validateSessionId } from "../utils/validation";

export interface ChatSocketData {
  kind: "chat";
  sessionId: string;
}

export type ChatSocketEvent =
  | { type: "connected"; sessionId: string }
  | { type: "message_created"; sessionId: string; message: ChatMessage }
  | { type: "message_delta"; sessionId: string; messageId: string; delta: string }
  | { type: "message_updated"; sessionId: string; message: ChatMessage }
  | { type: "session_status"; sessionId: string; session: PublicCodexSession }
  | { type: "error"; sessionId: string; code: string; message: string };

export type ChatWebSocket = Bun.ServerWebSocket<ChatSocketData>;

export class ChatSocketBroadcaster {
  private readonly clients = new Map<string, Set<ChatWebSocket>>();

  attach(sessionId: string, ws: ChatWebSocket): void {
    if (!this.clients.has(sessionId)) {
      this.clients.set(sessionId, new Set());
    }
    this.clients.get(sessionId)?.add(ws);
    this.send(ws, { type: "connected", sessionId });
  }

  detach(sessionId: string, ws: ChatWebSocket): void {
    const clients = this.clients.get(sessionId);
    clients?.delete(ws);
    if (clients?.size === 0) {
      this.clients.delete(sessionId);
    }
  }

  broadcast(sessionId: string, event: ChatSocketEvent): void {
    const encoded = JSON.stringify(event);
    for (const client of this.clients.get(sessionId) ?? []) {
      client.send(encoded);
    }
  }

  send(ws: ChatWebSocket, event: ChatSocketEvent): void {
    ws.send(JSON.stringify(event));
  }
}

export function tryUpgradeChatSocket(
  request: Request,
  server: Bun.Server<ChatSocketData>,
  authService: AuthService
): Response | undefined {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/ws\/sessions\/([^/]+)\/chat$/);
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
    data: { kind: "chat", sessionId }
  });
  if (!upgraded) {
    return new Response("WebSocket upgrade failed", { status: 400 });
  }
  return undefined;
}
