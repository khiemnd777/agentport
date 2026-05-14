import { Hono } from "hono";
import type { CodexChatService } from "../services/codexChatService";
import type { SessionService } from "../services/sessionService";
import { toPublicSession } from "../services/sessionService";
import { badRequest } from "../utils/httpErrors";
import { parsePageLimit } from "../utils/pagination";
import { parseJsonObject, validateRepoKey, validateSessionId } from "../utils/validation";

export function chatRoutes(sessionService: SessionService, codexChatService: CodexChatService): Hono {
  const app = new Hono();

  app.get("/codex/history", async (c) => {
    const repoKey = c.req.query("repo_key");
    const page = await codexChatService.listCodexHistoryPage(repoKey ? validateRepoKey(repoKey) : null, {
      limit: parsePageLimit(c.req.query("limit")),
      cursor: c.req.query("cursor")
    });
    return c.json({ threads: page.items, next_cursor: page.next_cursor, has_more: page.has_more });
  });

  app.post("/codex/history/:threadId/open", async (c) => {
    const threadId = validateCodexThreadId(c.req.param("threadId"));
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    const repoKey = validateRepoKey(body.repo_key);
    const session = await codexChatService.openCodexHistoryThread(threadId, repoKey);
    return c.json({ session: toPublicSession(session) }, 201);
  });

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
    const planMode = body.planMode === true;
    if (attachmentIds !== undefined && !Array.isArray(attachmentIds)) {
      throw badRequest("attachmentIds must be an array");
    }
    const result = await codexChatService.sendMessage(session, prompt, model, reasoningEffort, permissionMode, attachmentIds, {
      planMode
    });
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

function validateCodexThreadId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) {
    throw badRequest("Invalid Codex thread id");
  }
  return value;
}
