import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/config";
import { AuthService } from "../src/auth/authService";

const config: AppConfig = {
  server: { host: "127.0.0.1", port: 8787 },
  auth: { requirePassword: true },
  repos: {},
  defaultRepo: "noah",
  repoDiscovery: { searchRoots: [], maxDepth: 4 },
  codex: {
    command: "codex",
    defaultArgs: [],
    taskTimeoutMinutes: 0,
    defaultModel: "gpt-5.5",
    models: [{ id: "gpt-5.5", label: "GPT-5.5" }],
    defaultReasoningEffort: "medium",
    reasoningEfforts: [{ id: "medium", label: "Medium" }],
    defaultPermissionMode: "default",
    permissionModes: [
      {
        id: "default",
        label: "Default permissions",
        description: "Ask before sensitive actions while keeping the workspace sandbox on.",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: "workspace-write"
      }
    ]
  },
  limits: { maxActiveSessions: 1, maxActiveTasks: 1, maxLogBytesPerSession: 1024 },
  sessions: { autoArchiveStoppedAfterMinutes: 1440, deleteArchivedAfterDays: 0 }
};

describe("auth service", () => {
  test("persists login sessions across service instances", async () => {
    await withTempDataRoot(async (dataRoot) => {
      await withAppPassword("old-password", async () => {
        const first = new AuthService(config, dataRoot);
        await first.init();
        const issued = await first.login("old-password");

        const second = new AuthService(config, dataRoot);
        await second.init();

        expect(second.authenticate(issued.token)?.id).toBe(issued.id);
        expect(second.authenticate("not-a-real-token")).toBeNull();
      });
    });
  });

  test("invalidates persisted sessions when APP_PASSWORD changes", async () => {
    await withTempDataRoot(async (dataRoot) => {
      let issuedToken = "";
      await withAppPassword("old-password", async () => {
        const first = new AuthService(config, dataRoot);
        await first.init();
        issuedToken = (await first.login("old-password")).token;
      });

      await withAppPassword("new-password", async () => {
        const second = new AuthService(config, dataRoot);
        await second.init();

        expect(second.authenticate(issuedToken)).toBeNull();
      });
    });
  });

  test("logout removes a persisted session", async () => {
    await withTempDataRoot(async (dataRoot) => {
      await withAppPassword("password", async () => {
        const first = new AuthService(config, dataRoot);
        await first.init();
        const issued = await first.login("password");
        await first.logout(issued.token);

        const second = new AuthService(config, dataRoot);
        await second.init();

        expect(second.authenticate(issued.token)).toBeNull();
      });
    });
  });
});

async function withTempDataRoot(run: (dataRoot: string) => Promise<void>): Promise<void> {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-port-auth-"));
  try {
    await run(dataRoot);
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
}

async function withAppPassword(password: string, run: () => Promise<void>): Promise<void> {
  const previous = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = password;
  try {
    await run();
  } finally {
    if (previous === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = previous;
    }
  }
}
