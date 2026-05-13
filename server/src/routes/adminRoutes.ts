import { Hono } from "hono";
import type { ServerControlService } from "../services/serverControlService";

export function adminRoutes(serverControlService: ServerControlService): Hono {
  const app = new Hono();

  app.post("/restart", (c) => {
    return c.json(serverControlService.requestRestart());
  });

  return app;
}
