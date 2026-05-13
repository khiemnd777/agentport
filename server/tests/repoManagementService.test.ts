import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/config";
import { loadConfigFile } from "../src/config";
import { RepoManagementService } from "../src/services/repoManagementService";
import { RepoRegistry } from "../src/services/repoRegistry";

const tempRoots: string[] = [];
const repoDiscoveryEnvKeys = ["RCD_REPO_SEARCH_ROOTS", "RCD_REPO_SEARCH_MAX_DEPTH"] as const;
const previousRepoDiscoveryEnv = new Map<(typeof repoDiscoveryEnvKeys)[number], string | undefined>();

beforeEach(() => {
  previousRepoDiscoveryEnv.clear();
  for (const key of repoDiscoveryEnvKeys) {
    previousRepoDiscoveryEnv.set(key, process.env[key]);
    process.env[key] = "";
  }
});

afterEach(async () => {
  for (const key of repoDiscoveryEnvKeys) {
    const previous = previousRepoDiscoveryEnv.get(key);
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("repo management service", () => {
  test("resolves a selected browser folder name without exposing the full path", async () => {
    const { service } = await createService();

    const result = await service.resolveFolder("agent_port");

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].folderName).toBe("agent_port");
    expect(result.candidates[0].suggestedKey).toBe("agent_port");
    expect(result.candidates[0]).not.toHaveProperty("path");
  });

  test("adds a resolved project folder to config and reloads the registry", async () => {
    const { service, registry, configPath, projectPath } = await createService();

    const result = await service.addRepo({
      folderName: "agent_port",
      label: "Agent Port",
      key: "agent_port"
    });

    expect(result.repo).toEqual({ key: "agent_port", label: "Agent Port" });
    expect(registry.getRepo("agent_port").path).toBe(projectPath);

    const raw = JSON.parse(await fs.readFile(configPath, "utf8")) as AppConfig;
    expect(raw.repos.agent_port).toEqual({
      label: "Agent Port",
      path: projectPath
    });
  });

  test("requires a candidate id when multiple folders share the selected name", async () => {
    const { service, root } = await createService({ duplicateProject: true });

    await expect(
      service.addRepo({
        folderName: "agent_port",
        label: "Agent Port",
        key: "agent_port"
      })
    ).rejects.toThrow("Multiple matching project folders found");

    const { candidates } = await service.resolveFolder("agent_port");
    await expect(
      service.addRepo({
        folderName: "agent_port",
        label: "Agent Port",
        key: "agent_port",
        candidateId: candidates[0].id
      })
    ).resolves.toMatchObject({ repo: { key: "agent_port", label: "Agent Port" } });

    expect(root).toBeTruthy();
  });

  test("removes a non-default repo from config and reloads the registry", async () => {
    const { service, registry, configPath } = await createService();
    await service.addRepo({ folderName: "agent_port", label: "Agent Port", key: "agent_port" });

    const result = await service.removeRepo("agent_port");

    expect(result.repos.map((repo) => repo.key)).toEqual(["noah"]);
    expect(() => registry.getRepo("agent_port")).toThrow("Unknown repo_key");

    const raw = JSON.parse(await fs.readFile(configPath, "utf8")) as AppConfig;
    expect(raw.repos.agent_port).toBeUndefined();
  });
});

async function createService(options: { duplicateProject?: boolean } = {}): Promise<{
  root: string;
  projectPath: string;
  configPath: string;
  registry: RepoRegistry;
  service: RepoManagementService;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-port-repos-"));
  tempRoots.push(root);

  const noahPath = path.join(root, "project_noah", "noah");
  const projectPath = path.join(root, "agent_port");
  await fs.mkdir(path.join(noahPath, ".git"), { recursive: true });
  await fs.mkdir(path.join(projectPath, ".git"), { recursive: true });
  const projectRealPath = await fs.realpath(projectPath);
  if (options.duplicateProject) {
    await fs.mkdir(path.join(root, "archive", "agent_port", ".git"), { recursive: true });
  }

  const configPath = path.join(root, "config.json");
  await fs.writeFile(configPath, JSON.stringify(baseConfig(root, noahPath), null, 2), "utf8");

  const runtimeConfig = await loadConfigFile(configPath);
  const registry = new RepoRegistry(runtimeConfig);
  await registry.init();

  return {
    root,
    projectPath: projectRealPath,
    configPath,
    registry,
    service: new RepoManagementService(runtimeConfig, configPath, registry)
  };
}

function baseConfig(root: string, noahPath: string): AppConfig {
  return {
    server: { host: "127.0.0.1", port: 8787 },
    auth: { requirePassword: false },
    repos: {
      noah: {
        label: "Noah",
        path: noahPath
      }
    },
    defaultRepo: "noah",
    repoDiscovery: {
      searchRoots: [root],
      maxDepth: 4
    },
    codex: {
      command: "codex",
      defaultArgs: [],
      taskTimeoutMinutes: 60,
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
    sessions: { autoArchiveStoppedAfterMinutes: 0, deleteArchivedAfterDays: 30 }
  };
}
