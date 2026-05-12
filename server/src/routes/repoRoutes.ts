import { Hono } from "hono";
import type { RepoRegistry } from "../services/repoRegistry";

export function repoRoutes(repoRegistry: RepoRegistry): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({
      repos: repoRegistry.listPublic(),
      defaultRepo: repoRegistry.getDefaultRepoKey()
    });
  });

  return app;
}
