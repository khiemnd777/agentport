import { Hono } from "hono";
import type { PtySessionManager } from "../pty/PtySessionManager";
import type { SessionCleanupService } from "../services/sessionCleanupService";
import type { SessionService } from "../services/sessionService";
import { toPublicSession } from "../services/sessionService";
import type { TaskService } from "../services/taskService";
import type { CodexChatService } from "../services/codexChatService";
import { toPublicTask } from "../services/taskService";
import { badRequest } from "../utils/httpErrors";
import { parsePageLimit } from "../utils/pagination";
import { parseJsonObject, validateBranchName, validateRepoKey, validateSessionId } from "../utils/validation";
import type { SessionSource } from "../domain/sessionTypes";

export function sessionRoutes(
  sessionService: SessionService,
  taskService: TaskService,
  ptySessionManager: PtySessionManager,
  sessionCleanupService: SessionCleanupService,
  codexChatService: CodexChatService
): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    if ("repo_path" in body) {
      throw badRequest("Send repo_key, not repo_path");
    }

    const repoKey = validateRepoKey(body.repo_key);
    const branchName = validateBranchName(body.branch_name);
    const title = typeof body.title === "string" ? body.title : undefined;
    const initialPrompt = typeof body.initial_prompt === "string" ? body.initial_prompt.trim() : "";
    const session = await sessionService.create({
      repo_key: repoKey,
      branch_name: branchName,
      title,
      source: detectSource(c.req.header("user-agent") ?? ""),
      control_mode: "web_managed"
    });

    try {
      await ptySessionManager.startSession(session);
      if (initialPrompt) {
        const task = await taskService.createAndStart(sessionService.get(session.id), {
          title: title || "Initial task",
          prompt: initialPrompt
        });
        await ptySessionManager.writeTaskPrompt(session.id, task.wrapped_prompt);
        return c.json({ session: toPublicSession(sessionService.get(session.id)), task: toPublicTask(task) }, 201);
      }
      return c.json({ session: toPublicSession(sessionService.get(session.id)) }, 201);
    } catch (error) {
      await sessionService.updateTerminalStatus(session.id, "ERROR");
      throw error;
    }
  });

  app.get("/", async (c) => {
    await sessionCleanupService.sweep();
    void codexChatService.syncSessions({ importThreads: true, readThreads: false }).catch(() => undefined);
    const view = parseSessionListView(c.req.query("view"), c.req.query("include_archived"));
    const page = sessionService.listPublicPage({
      view,
      limit: parsePageLimit(c.req.query("limit")),
      cursor: c.req.query("cursor")
    });
    return c.json({ sessions: page.items, next_cursor: page.next_cursor, has_more: page.has_more });
  });

  app.get("/:id", (c) => {
    const id = validateSessionId(c.req.param("id"));
    return c.json({ session: sessionService.getPublic(id) });
  });

  app.post("/:id/close", async (c) => {
    const id = validateSessionId(c.req.param("id"));
    await taskService.cancelActiveTaskForSession(id);
    await ptySessionManager.closeSession(id);
    return c.json({ session: sessionService.getPublic(id) });
  });

  app.post("/:id/archive", async (c) => {
    const id = validateSessionId(c.req.param("id"));
    await sessionCleanupService.archive(id);
    return c.json({ session: sessionService.getPublic(id) });
  });

  app.patch("/:id/run-profile", async (c) => {
    const id = validateSessionId(c.req.param("id"));
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    const session = await sessionService.updateRunProfile(id, {
      model: body.model,
      reasoning_effort: body.reasoning_effort,
      permission_mode: body.permission_mode,
      plan_mode: body.plan_mode
    });
    return c.json({ session: toPublicSession(session) });
  });

  app.delete("/:id", async (c) => {
    const id = validateSessionId(c.req.param("id"));
    await sessionCleanupService.delete(id);
    return c.json({ ok: true });
  });

  app.post("/:id/resize", async (c) => {
    const id = validateSessionId(c.req.param("id"));
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    const cols = typeof body.cols === "number" ? body.cols : 120;
    const rows = typeof body.rows === "number" ? body.rows : 40;
    ptySessionManager.resize(id, cols, rows);
    return c.json({ ok: true });
  });

  return app;
}

function detectSource(userAgent: string): SessionSource {
  return /iphone|ipad|mobile/i.test(userAgent) ? "iphone_web" : "desktop_web";
}

function parseSessionListView(view: string | undefined, includeArchived: string | undefined): "active" | "archived" | "all" {
  if (view === undefined || view === "") {
    return includeArchived === "true" ? "all" : "active";
  }
  if (view === "active" || view === "archived" || view === "all") {
    return view;
  }
  throw badRequest("Unsupported sessions view");
}
