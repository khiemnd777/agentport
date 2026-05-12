import { Hono } from "hono";
import type { PtySessionManager } from "../pty/PtySessionManager";
import type { EventStore } from "../services/eventStore";
import type { SessionService } from "../services/sessionService";
import type { TaskService } from "../services/taskService";
import { toPublicTask } from "../services/taskService";
import { badRequest, conflict } from "../utils/httpErrors";
import { parseJsonObject, validateSessionId, validateTaskId } from "../utils/validation";
import { isTerminalTaskStatus } from "../domain/statusRules";

export function taskRoutes(
  sessionService: SessionService,
  taskService: TaskService,
  eventStore: EventStore,
  ptySessionManager: PtySessionManager
): Hono {
  const app = new Hono();

  app.post("/sessions/:id/tasks", async (c) => {
    const sessionId = validateSessionId(c.req.param("id"));
    const session = sessionService.get(sessionId);
    if (session.terminal_status !== "RUNNING") {
      throw conflict("Session is not running");
    }
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const title = typeof body.title === "string" ? body.title : undefined;
    const task = await taskService.createAndStart(session, { title, prompt });
    try {
      await ptySessionManager.writeTaskPrompt(session.id, task.wrapped_prompt);
    } catch (error) {
      await taskService.failTask(task.id, (error as Error).message);
      throw error;
    }
    ptySessionManager.broadcastStatus(session.id);
    return c.json({ task: toPublicTask(task) }, 201);
  });

  app.get("/tasks", (c) => c.json({ tasks: taskService.listPublic() }));

  app.get("/tasks/:id", (c) => {
    const taskId = validateTaskId(c.req.param("id"));
    return c.json({ task: taskService.getPublic(taskId) });
  });

  app.get("/tasks/:id/events", async (c) => {
    const taskId = validateTaskId(c.req.param("id"));
    const task = taskService.get(taskId);
    const events = await eventStore.listTaskEvents(task.session_id, task.id);
    return c.json({ events });
  });

  app.post("/tasks/:id/input", async (c) => {
    const taskId = validateTaskId(c.req.param("id"));
    const task = taskService.get(taskId);
    if (task.control_mode !== "web_managed") {
      throw conflict("This session is controlled from the local terminal. Remote input is disabled.");
    }
    if (isTerminalTaskStatus(task.status)) {
      throw conflict("Task is already finished");
    }
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      throw badRequest("Input text is required");
    }
    await ptySessionManager.writeTaskPrompt(task.session_id, text);
    const updated = await taskService.submitInput(task.id, text);
    ptySessionManager.broadcastStatus(task.session_id);
    return c.json({ task: toPublicTask(updated) });
  });

  app.post("/tasks/:id/cancel", async (c) => {
    const taskId = validateTaskId(c.req.param("id"));
    const existingTask = taskService.get(taskId);
    await ptySessionManager.interruptSession(existingTask.session_id);
    const task = await taskService.cancel(taskId);
    ptySessionManager.broadcastStatus(task.session_id);
    return c.json({ task: toPublicTask(task) });
  });

  return app;
}
