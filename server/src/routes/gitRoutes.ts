import { Hono } from "hono";
import type { EventStore } from "../services/eventStore";
import type { GitService } from "../services/gitService";
import type { SessionService } from "../services/sessionService";
import { validateRelativeFilePath, validateSessionId } from "../utils/validation";

export function gitRoutes(
  sessionService: SessionService,
  gitService: GitService,
  eventStore: EventStore
): Hono {
  const app = new Hono();

  app.get("/sessions/:id/git/status", async (c) => {
    const sessionId = validateSessionId(c.req.param("id"));
    const session = sessionService.get(sessionId);
    const status = await gitService.getStatus(session.repo_path);
    await eventStore.append({
      session_id: session.id,
      event_type: "git_status_refreshed",
      summary: "Git status refreshed",
      metadata: { changedFiles: status.files.length }
    });
    return c.json({ status });
  });

  app.get("/sessions/:id/git/diff", async (c) => {
    const sessionId = validateSessionId(c.req.param("id"));
    const session = sessionService.get(sessionId);
    const file = validateRelativeFilePath(c.req.query("file"));
    const diff = file ? await gitService.getFileDiff(session.repo_path, file) : await gitService.getDiff(session.repo_path);
    await eventStore.append({
      session_id: session.id,
      event_type: "git_diff_viewed",
      summary: "Git diff viewed",
      metadata: { file: file ?? null, bytes: diff.length }
    });
    return c.json({ diff, file: file ?? null });
  });

  return app;
}
