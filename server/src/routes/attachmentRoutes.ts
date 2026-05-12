import { Hono } from "hono";
import type { AttachmentService } from "../services/attachmentService";
import type { SessionService } from "../services/sessionService";
import { badRequest } from "../utils/httpErrors";
import { validateSessionId } from "../utils/validation";

export function attachmentRoutes(sessionService: SessionService, attachmentService: AttachmentService): Hono {
  const app = new Hono();

  app.post("/sessions/:id/attachments", async (c) => {
    const sessionId = validateSessionId(c.req.param("id"));
    const session = sessionService.get(sessionId);
    if (session.archived_at) {
      throw badRequest("Archived sessions are read-only");
    }
    const body = await c.req.parseBody().catch(() => {
      throw badRequest("Expected multipart/form-data");
    });
    const field = body.file;
    const file = Array.isArray(field) ? field[0] : field;
    if (!(file instanceof File)) {
      throw badRequest("Attachment file is required");
    }
    const attachment = await attachmentService.create(sessionId, file);
    return c.json({ attachment }, 201);
  });

  app.get("/sessions/:id/attachments/:attachmentId/content", async (c) => {
    const sessionId = validateSessionId(c.req.param("id"));
    sessionService.get(sessionId);
    const attachment = await attachmentService.getContent(sessionId, c.req.param("attachmentId"));
    const inline = attachment.kind === "image" || attachment.kind === "video";
    return new Response(Bun.file(attachment.stored_path), {
      headers: {
        "Content-Type": attachment.mime_type,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeHeaderFilename(attachment.original_name)}"`,
        "X-Content-Type-Options": "nosniff"
      }
    });
  });

  return app;
}

function encodeHeaderFilename(filename: string): string {
  return filename.replace(/["\\\r\n]/g, "_");
}
