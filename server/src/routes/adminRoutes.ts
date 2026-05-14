import { Hono } from "hono";
import type { ServerControlService } from "../services/serverControlService";

export function adminRoutes(serverControlService: ServerControlService): Hono {
  const app = new Hono();

  app.post("/restart", (c) => {
    const result = serverControlService.requestRestart();
    if (!result.ok) {
      return c.json({ error: result.error }, 409);
    }
    return c.json(result);
  });

  return app;
}
