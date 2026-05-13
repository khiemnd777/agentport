import { Hono } from "hono";
import type { RepoRegistry } from "../services/repoRegistry";
import type { RepoManagementService } from "../services/repoManagementService";
import type { SessionService } from "../services/sessionService";
import { badRequest, conflict } from "../utils/httpErrors";
import { parseJsonObject, validateRepoKey } from "../utils/validation";

export function repoRoutes(
  repoRegistry: RepoRegistry,
  repoManagementService: RepoManagementService,
  sessionService: SessionService
): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({
      repos: repoRegistry.listPublic(),
      defaultRepo: repoRegistry.getDefaultRepoKey(),
      repoDiscovery: repoManagementService.getDiscoveryStatus()
    });
  });

  app.post("/resolve-folder", async (c) => {
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    return c.json(await repoManagementService.resolveFolder(body.folderName));
  });

  app.post("/", async (c) => {
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    const result = await repoManagementService.addRepo({
      folderName: body.folderName,
      label: body.label,
      key: body.key,
      candidateId: body.candidateId
    });
    return c.json(result, 201);
  });

  app.post("/default", async (c) => {
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    return c.json(await repoManagementService.setDefaultRepo(body.repoKey));
  });

  app.delete("/:repoKey", async (c) => {
    let repoKey: string;
    try {
      repoKey = validateRepoKey(c.req.param("repoKey"));
    } catch (error) {
      throw badRequest((error as Error).message);
    }
    if (hasLiveSessionForRepo(sessionService, repoKey)) {
      throw conflict("Close active sessions for this repository before removing it");
    }
    return c.json(await repoManagementService.removeRepo(repoKey));
  });

  return app;
}

function hasLiveSessionForRepo(sessionService: SessionService, repoKey: string): boolean {
  return sessionService
    .list({ includeArchived: true })
    .some(
      (session) =>
        session.repo_key === repoKey &&
        ["CONNECTING", "CONNECTED", "RUNNING"].includes(session.terminal_status)
    );
}
