import { Hono } from "hono";
import type { CodexChatService } from "../services/codexChatService";
import type { SessionService } from "../services/sessionService";
import { badRequest } from "../utils/httpErrors";
import { parseJsonObject, validateSessionId } from "../utils/validation";

export function chatRoutes(sessionService: SessionService, codexChatService: CodexChatService): Hono {
  const app = new Hono();

  app.get("/sessions/:id/messages", async (c) => {
    const sessionId = validateSessionId(c.req.param("id"));
    return c.json({ messages: await codexChatService.listMessages(sessionId) });
  });

  app.get("/chat/models", (c) => c.json(codexChatService.listModels()));

  app.post("/sessions/:id/messages", async (c) => {
    const sessionId = validateSessionId(c.req.param("id"));
    const session = sessionService.get(sessionId);
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const model = typeof body.model === "string" ? body.model : undefined;
    const reasoningEffort = typeof body.reasoningEffort === "string" ? body.reasoningEffort : undefined;
    const permissionMode = typeof body.permissionMode === "string" ? body.permissionMode : undefined;
    const attachmentIds = body.attachmentIds;
    if (attachmentIds !== undefined && !Array.isArray(attachmentIds)) {
      throw badRequest("attachmentIds must be an array");
    }
    const result = await codexChatService.sendMessage(session, prompt, model, reasoningEffort, permissionMode, attachmentIds);
    return c.json(result, 201);
  });

  app.post("/sessions/:id/messages/input", async (c) => {
    const sessionId = validateSessionId(c.req.param("id"));
    const session = sessionService.get(sessionId);
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    const text = typeof body.text === "string" ? body.text : "";
    const result = await codexChatService.submitUserInput(session, text);
    return c.json(result, 201);
  });

  app.post("/sessions/:id/messages/interrupt", async (c) => {
    const sessionId = validateSessionId(c.req.param("id"));
    await codexChatService.interrupt(sessionId);
    return c.json({ ok: true });
  });

  return app;
}
