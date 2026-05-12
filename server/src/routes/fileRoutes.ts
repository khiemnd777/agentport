import { Hono } from "hono";
import type { FileContentService } from "../services/fileContentService";
import type { SessionService } from "../services/sessionService";
import { validateSessionId } from "../utils/validation";

export function fileRoutes(sessionService: SessionService, fileContentService: FileContentService): Hono {
  const app = new Hono();

  app.get("/sessions/:id/files/content", async (c) => {
    const sessionId = validateSessionId(c.req.param("id"));
    const session = sessionService.get(sessionId);
    const file = c.req.query("file");
    const name = c.req.query("name");
    const preview = file
      ? await fileContentService.readRelativeFile(session.repo_path, file)
      : await fileContentService.findAndReadByName(session.repo_path, name);
    return c.json({ file: preview });
  });

  return app;
}
