import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/config";
import { SessionService } from "../src/services/sessionService";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const config: AppConfig = {
  server: { host: "127.0.0.1", port: 8787 },
  auth: { requirePassword: false },
  repos: {},
  defaultRepo: "noah",
  repoDiscovery: { searchRoots: [], maxDepth: 4 },
  codex: {
    command: "codex",
    defaultArgs: [],
    taskTimeoutMinutes: 60,
    defaultModel: "gpt-5.5",
    models: [
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4", label: "GPT-5.4" }
    ],
    defaultReasoningEffort: "medium",
    reasoningEfforts: [
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" }
    ],
    defaultPermissionMode: "default",
    permissionModes: [
      {
        id: "default",
        label: "Default permissions",
        description: "Ask before sensitive actions while keeping the workspace sandbox on.",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: "workspace-write"
      },
      {
        id: "auto-review",
        label: "Auto-review",
        description: "Route eligible approval requests through Codex auto-review.",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandbox: "workspace-write"
      }
    ]
  },
  limits: { maxActiveSessions: 10, maxActiveTasks: 10, maxLogBytesPerSession: 1024 },
  sessions: { autoArchiveStoppedAfterMinutes: 0, deleteArchivedAfterDays: 30 }
};

describe("session service sync state", () => {
  test("lists active, archived, and all sessions separately", async () => {
    const service = await createSessionService();
    const active = await service.create({
      repo_key: "noah",
      title: "Active session",
      source: "desktop_web",
      control_mode: "web_managed"
    });
    const archived = await service.create({
      repo_key: "noah",
      title: "Archived session",
      source: "desktop_web",
      control_mode: "web_managed"
    });
    await service.updateTerminalStatus(archived.id, "DISCONNECTED");
    await service.archive(archived.id);

    expect(service.list({ view: "active" }).map((session) => session.id)).toEqual([active.id]);
    expect(service.list({ view: "archived" }).map((session) => session.id)).toEqual([archived.id]);
    expect(new Set(service.list({ view: "all" }).map((session) => session.id))).toEqual(new Set([active.id, archived.id]));
  });

  test("pages session lists with stable cursors", async () => {
    const service = await createSessionService();
    const oldest = await service.create({
      repo_key: "noah",
      title: "Oldest",
      source: "desktop_web",
      control_mode: "web_managed"
    });
    const middle = await service.create({
      repo_key: "noah",
      title: "Middle",
      source: "desktop_web",
      control_mode: "web_managed"
    });
    const newest = await service.create({
      repo_key: "noah",
      title: "Newest",
      source: "desktop_web",
      control_mode: "web_managed"
    });
    oldest.updated_at = "2026-05-14T00:00:00.000Z";
    middle.updated_at = "2026-05-14T00:01:00.000Z";
    newest.updated_at = "2026-05-14T00:02:00.000Z";
    await service.save(oldest);
    await service.save(middle);
    await service.save(newest);

    const firstPage = service.listPublicPage({ view: "active", limit: 2 });
    const secondPage = service.listPublicPage({ view: "active", limit: 2, cursor: firstPage.next_cursor });

    expect(firstPage.items.map((session) => session.id)).toEqual([newest.id, middle.id]);
    expect(firstPage.has_more).toBe(true);
    expect(typeof firstPage.next_cursor).toBe("string");
    expect(secondPage.items.map((session) => session.id)).toEqual([oldest.id]);
    expect(secondPage.has_more).toBe(false);
    expect(secondPage.next_cursor).toBeNull();
  });

  test("stores run profile per session without reordering sessions", async () => {
    const service = await createSessionService();
    const session = await service.create({
      repo_key: "noah",
      source: "desktop_web",
      control_mode: "web_managed"
    });
    session.updated_at = "2026-05-14T00:00:01.000Z";
    session.run_profile.updated_at = "2026-05-14T00:00:00.000Z";
    await service.save(session);
    const previousRunProfileUpdatedAt = session.run_profile.updated_at;

    const updated = await service.updateRunProfile(session.id, {
      model: "gpt-5.4",
      reasoning_effort: "high",
      permission_mode: "auto-review",
      plan_mode: true
    });

    expect(updated.run_profile).toMatchObject({
      model: "gpt-5.4",
      reasoning_effort: "high",
      permission_mode: "auto-review",
      plan_mode: true
    });
    expect(updated.run_profile.updated_at).not.toBe(previousRunProfileUpdatedAt);
    expect(updated.updated_at).toBe("2026-05-14T00:00:01.000Z");
  });

  test("rejects unsupported run profile values", async () => {
    const service = await createSessionService();
    const session = await service.create({
      repo_key: "noah",
      source: "desktop_web",
      control_mode: "web_managed"
    });

    await expect(service.updateRunProfile(session.id, { model: "not-supported" })).rejects.toThrow(
      "Unsupported Codex model"
    );
    await expect(service.updateRunProfile(session.id, { plan_mode: "true" })).rejects.toThrow("Invalid plan_mode");
  });

  test("does not churn session ordering timestamp when sync state is unchanged", async () => {
    const service = await createSessionService();
    const session = await service.create({
      repo_key: "noah",
      source: "desktop_web",
      control_mode: "web_managed"
    });
    session.codex_thread_id = "thread-1";
    session.sync_status = "synced";
    session.control_state = "idle";
    session.last_synced_at = "2026-05-14T00:00:00.000Z";
    session.codex_thread_updated_at = "2026-05-14T00:00:00.000Z";
    session.updated_at = "2026-05-14T00:00:01.000Z";
    await service.save(session);

    const updated = await service.setSyncState(session.id, {
      sync_status: "synced",
      control_state: "idle",
      last_sync_error: null,
      codex_thread_updated_at: "2026-05-14T00:00:00.000Z",
      task_status: "IDLE"
    });

    expect(updated.updated_at).toBe("2026-05-14T00:00:01.000Z");
    expect(updated.last_synced_at).toBe("2026-05-14T00:00:00.000Z");
  });

  test("records real thread changes without reordering the session list", async () => {
    const service = await createSessionService();
    const session = await service.create({
      repo_key: "noah",
      source: "desktop_web",
      control_mode: "web_managed"
    });
    session.codex_thread_id = "thread-1";
    session.sync_status = "synced";
    session.control_state = "idle";
    session.last_synced_at = "2026-05-14T00:00:00.000Z";
    session.codex_thread_updated_at = "2026-05-14T00:00:00.000Z";
    session.updated_at = "2026-05-14T00:00:01.000Z";
    await service.save(session);

    const updated = await service.setSyncState(session.id, {
      sync_status: "synced",
      control_state: "desktop_active",
      last_sync_error: null,
      codex_thread_updated_at: "2026-05-14T00:00:10.000Z",
      task_status: "RUNNING"
    });

    expect(updated.control_state).toBe("desktop_active");
    expect(updated.codex_thread_updated_at).toBe("2026-05-14T00:00:10.000Z");
    expect(updated.task_status).toBe("RUNNING");
    expect(updated.updated_at).toBe("2026-05-14T00:00:01.000Z");
    expect(updated.last_synced_at).not.toBe("2026-05-14T00:00:00.000Z");
  });

  test("reimporting an unchanged desktop thread does not reorder the session list", async () => {
    const service = await createSessionService();
    const session = await service.importCodexThread({
      repo_key: "noah",
      title: "Desktop thread",
      codex_thread_id: "thread-1",
      codex_thread_updated_at: "2026-05-14T00:00:00.000Z",
      control_state: "idle",
      created_at: "2026-05-14T00:00:00.000Z"
    });
    session.updated_at = "2026-05-14T00:00:01.000Z";
    session.last_synced_at = "2026-05-14T00:00:02.000Z";
    await service.save(session);

    const imported = await service.importCodexThread({
      repo_key: "noah",
      title: "Desktop thread",
      codex_thread_id: "thread-1",
      codex_thread_updated_at: "2026-05-14T00:00:00.000Z",
      control_state: "idle",
      created_at: "2026-05-14T00:00:00.000Z"
    });

    expect(imported.updated_at).toBe("2026-05-14T00:00:01.000Z");
    expect(imported.last_synced_at).toBe("2026-05-14T00:00:02.000Z");
  });

  test("persists forgotten Codex thread tombstones", async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), "agent-port-session-forgotten-"));
    tempRoots.push(dataRoot);
    const service = await createSessionService(dataRoot);

    await service.forgetCodexThread("thread-1");
    await service.forgetCodexThread("thread-2");
    await service.unforgetCodexThread("thread-2");

    const reloaded = await createSessionService(dataRoot);
    expect(reloaded.isCodexThreadForgotten("thread-1")).toBe(true);
    expect(reloaded.isCodexThreadForgotten("thread-2")).toBe(false);
  });

  test("explicitly opening a desktop thread restores an archived local session", async () => {
    const service = await createSessionService();
    const session = await service.importCodexThread({
      repo_key: "noah",
      title: "Desktop thread",
      codex_thread_id: "thread-1",
      codex_thread_updated_at: "2026-05-14T00:00:00.000Z",
      control_state: "idle",
      created_at: "2026-05-14T00:00:00.000Z"
    });
    await service.archive(session.id);

    const restored = await service.importCodexThread({
      repo_key: "noah",
      title: "Desktop thread",
      codex_thread_id: "thread-1",
      codex_thread_updated_at: "2026-05-14T00:00:00.000Z",
      control_state: "idle",
      created_at: "2026-05-14T00:00:00.000Z",
      restore: true
    });

    expect(restored.id).toBe(session.id);
    expect(restored.archived_at).toBeNull();
    expect(service.list({ view: "active" }).map((item) => item.id)).toContain(session.id);
  });

  test("reimporting a changed desktop thread updates control state without reordering", async () => {
    const service = await createSessionService();
    const session = await service.importCodexThread({
      repo_key: "noah",
      title: "Desktop thread",
      codex_thread_id: "thread-1",
      codex_thread_updated_at: "2026-05-14T00:00:00.000Z",
      control_state: "idle",
      created_at: "2026-05-14T00:00:00.000Z"
    });
    session.updated_at = "2026-05-14T00:00:01.000Z";
    session.last_synced_at = "2026-05-14T00:00:02.000Z";
    await service.save(session);

    const imported = await service.importCodexThread({
      repo_key: "noah",
      title: "Desktop thread",
      codex_thread_id: "thread-1",
      codex_thread_updated_at: "2026-05-14T00:00:10.000Z",
      control_state: "desktop_active",
      created_at: "2026-05-14T00:00:00.000Z"
    });

    expect(imported.control_state).toBe("desktop_active");
    expect(imported.codex_thread_updated_at).toBe("2026-05-14T00:00:10.000Z");
    expect(imported.updated_at).toBe("2026-05-14T00:00:01.000Z");
    expect(imported.last_synced_at).not.toBe("2026-05-14T00:00:02.000Z");
  });

  test("auto-archives idle synced Codex threads but keeps controlled threads active", async () => {
    const service = await createSessionService();
    const oldThreadUpdatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const idle = await service.importCodexThread({
      repo_key: "noah",
      title: "Idle desktop thread",
      codex_thread_id: "thread-idle",
      codex_thread_updated_at: oldThreadUpdatedAt,
      control_state: "idle",
      created_at: oldThreadUpdatedAt
    });
    const desktopActive = await service.importCodexThread({
      repo_key: "noah",
      title: "Active desktop thread",
      codex_thread_id: "thread-desktop-active",
      codex_thread_updated_at: oldThreadUpdatedAt,
      control_state: "desktop_active",
      created_at: oldThreadUpdatedAt
    });
    const mobileControl = await service.importCodexThread({
      repo_key: "noah",
      title: "Mobile controlled thread",
      codex_thread_id: "thread-mobile-control",
      codex_thread_updated_at: oldThreadUpdatedAt,
      control_state: "mobile_control",
      created_at: oldThreadUpdatedAt
    });

    const archived = await service.archiveStoppedOlderThan(60);

    expect(archived.map((session) => session.id)).toEqual([idle.id]);
    expect(service.get(idle.id).archived_at).not.toBeNull();
    expect(service.get(desktopActive.id).archived_at).toBeNull();
    expect(service.get(mobileControl.id).archived_at).toBeNull();
  });
});

async function createSessionService(dataRootInput?: string): Promise<SessionService> {
  const dataRoot = dataRootInput ?? (await mkdtemp(path.join(tmpdir(), "agent-port-session-sync-")));
  if (!dataRootInput) {
    tempRoots.push(dataRoot);
  }
  const service = new SessionService(
    dataRoot,
    config,
    { getRepo: () => ({ key: "noah", label: "Noah", path: "/tmp/noah" }) } as never,
    { append: async () => undefined } as never,
    { getCurrentBranch: async () => "main" } as never
  );
  await service.init();
  return service;
}
