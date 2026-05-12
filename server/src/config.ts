import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RepoConfig } from "./domain/repoTypes";

export interface AppConfig {
  server: {
    host: string;
    port: number;
  };
  auth: {
    requirePassword: boolean;
  };
  repos: Record<string, RepoConfig>;
  defaultRepo: string;
  codex: {
    command: string;
    defaultArgs: string[];
    taskTimeoutMinutes: number;
    defaultModel: string;
    models: CodexModelConfig[];
    defaultReasoningEffort: CodexReasoningEffort;
    reasoningEfforts: CodexReasoningEffortConfig[];
    defaultPermissionMode: CodexPermissionMode;
    permissionModes: CodexPermissionModeConfig[];
  };
  limits: {
    maxActiveSessions: number;
    maxActiveTasks: number;
    maxLogBytesPerSession: number;
  };
  sessions: {
    autoArchiveStoppedAfterMinutes: number;
    deleteArchivedAfterDays: number;
  };
}

export interface CodexModelConfig {
  id: string;
  label: string;
}

export type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface CodexReasoningEffortConfig {
  id: CodexReasoningEffort;
  label: string;
}

export type CodexPermissionMode = "default" | "auto-review" | "full-access";
export type CodexApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";
export type CodexApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexPermissionModeConfig {
  id: CodexPermissionMode;
  label: string;
  description: string;
  approvalPolicy: CodexApprovalPolicy;
  approvalsReviewer: CodexApprovalsReviewer;
  sandbox: CodexSandboxMode;
  highRisk?: boolean;
}

export interface RuntimePaths {
  appRoot: string;
  dataRoot: string;
  webDist: string;
  configPath: string;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(currentDir, "../..");
const DEFAULT_CODEX_MODELS: CodexModelConfig[] = [
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" }
];
const DEFAULT_CODEX_REASONING_EFFORTS: CodexReasoningEffortConfig[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" }
];
const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "medium";
const DEFAULT_CODEX_PERMISSION_MODES: CodexPermissionModeConfig[] = [
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
    description: "Route eligible approval requests through Codex auto-review in the workspace sandbox.",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
    sandbox: "workspace-write"
  },
  {
    id: "full-access",
    label: "Full access",
    description: "Run without sandbox or approval prompts. Use only with trusted repositories.",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: "danger-full-access",
    highRisk: true
  }
];
const DEFAULT_CODEX_PERMISSION_MODE: CodexPermissionMode = "default";

async function firstExistingPath(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export async function loadConfig(): Promise<{ config: AppConfig; paths: RuntimePaths }> {
  await loadRootEnvFile();

  const envConfigPath = process.env.RCD_CONFIG_PATH;
  const candidates = [
    ...expandConfigPath(envConfigPath),
    path.resolve(process.cwd(), "config.json"),
    path.resolve(process.cwd(), "../config.json"),
    path.resolve(process.cwd(), "agent-port/config.json"),
    path.resolve(process.cwd(), "remote-codex-desktop/config.json"),
    path.resolve(appRoot, "config.json")
  ];

  const configPath = await firstExistingPath(candidates);
  if (!configPath) {
    throw new Error(
      "Missing config.json. Copy config.example.json to config.json and update the repo whitelist."
    );
  }

  const raw = await fs.readFile(configPath, "utf8");
  const config = JSON.parse(raw) as AppConfig;
  applyConfigDefaults(config);
  applyEnvOverrides(config);
  validateConfig(config);

  return {
    config,
    paths: {
      appRoot,
      dataRoot: path.resolve(appRoot, "data"),
      webDist: path.resolve(appRoot, "web/dist"),
      configPath
    }
  };
}

function expandConfigPath(configPath: string | undefined): string[] {
  if (!configPath) {
    return [];
  }
  if (path.isAbsolute(configPath)) {
    return [configPath];
  }
  return [path.resolve(process.cwd(), configPath), path.resolve(appRoot, configPath)];
}

async function loadRootEnvFile(): Promise<void> {
  const envPath = path.resolve(appRoot, ".env");
  let raw: string;
  try {
    raw = await fs.readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = normalized.slice(0, equalsIndex).trim();
    const value = normalizeEnvValue(normalized.slice(equalsIndex + 1).trim());
    process.env[key] ??= value;
  }
}

function normalizeEnvValue(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function applyConfigDefaults(config: AppConfig): void {
  config.sessions ??= {
    autoArchiveStoppedAfterMinutes: 0,
    deleteArchivedAfterDays: 30
  };
  config.sessions.autoArchiveStoppedAfterMinutes ??= 0;
  config.sessions.deleteArchivedAfterDays ??= 30;
  config.codex.models = normalizeCodexModels(config.codex.models);
  config.codex.defaultModel = normalizeDefaultModel(config.codex.defaultModel, config.codex.models);
  config.codex.reasoningEfforts = normalizeCodexReasoningEfforts(config.codex.reasoningEfforts);
  config.codex.defaultReasoningEffort = normalizeDefaultReasoningEffort(
    config.codex.defaultReasoningEffort,
    config.codex.reasoningEfforts
  );
  config.codex.permissionModes = normalizeCodexPermissionModes(config.codex.permissionModes);
  config.codex.defaultPermissionMode = normalizeDefaultPermissionMode(
    config.codex.defaultPermissionMode,
    config.codex.permissionModes
  );
}

function applyEnvOverrides(config: AppConfig): void {
  config.server.host = readStringEnv("RCD_SERVER_HOST", config.server.host);
  config.server.port = readNumberEnv("RCD_SERVER_PORT", config.server.port);
  config.codex.command = readStringEnv("RCD_CODEX_COMMAND", config.codex.command);
  config.codex.taskTimeoutMinutes = readNumberEnv(
    "RCD_TASK_TIMEOUT_MINUTES",
    config.codex.taskTimeoutMinutes
  );
  config.limits.maxActiveSessions = readNumberEnv(
    "RCD_MAX_ACTIVE_SESSIONS",
    config.limits.maxActiveSessions
  );
  config.limits.maxActiveTasks = readNumberEnv(
    "RCD_MAX_ACTIVE_TASKS",
    config.limits.maxActiveTasks
  );
  config.limits.maxLogBytesPerSession = readNumberEnv(
    "RCD_MAX_LOG_BYTES_PER_SESSION",
    config.limits.maxLogBytesPerSession
  );
  config.sessions.autoArchiveStoppedAfterMinutes = readNumberEnv(
    "RCD_AUTO_ARCHIVE_STOPPED_AFTER_MINUTES",
    config.sessions.autoArchiveStoppedAfterMinutes
  );
  config.sessions.deleteArchivedAfterDays = readNumberEnv(
    "RCD_DELETE_ARCHIVED_AFTER_DAYS",
    config.sessions.deleteArchivedAfterDays
  );
}

function readStringEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function readNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value || !value.trim()) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}

function validateConfig(config: AppConfig): void {
  if (!config.server || typeof config.server.host !== "string" || typeof config.server.port !== "number") {
    throw new Error("Invalid server config");
  }
  if (!config.auth || typeof config.auth.requirePassword !== "boolean") {
    throw new Error("Invalid auth config");
  }
  if (!config.repos || typeof config.repos !== "object" || Array.isArray(config.repos)) {
    throw new Error("Invalid repo config");
  }
  if (!config.repos[config.defaultRepo]) {
    throw new Error("defaultRepo must point at a whitelisted repo key");
  }
  if (
    !config.codex?.command ||
    !Array.isArray(config.codex.defaultArgs) ||
    !Array.isArray(config.codex.models) ||
    !config.codex.models.length ||
    !config.codex.models.some((model) => model.id === config.codex.defaultModel) ||
    !Array.isArray(config.codex.reasoningEfforts) ||
    !config.codex.reasoningEfforts.length ||
    !config.codex.reasoningEfforts.some((effort) => effort.id === config.codex.defaultReasoningEffort) ||
    !Array.isArray(config.codex.permissionModes) ||
    !config.codex.permissionModes.length ||
    !config.codex.permissionModes.some((mode) => mode.id === config.codex.defaultPermissionMode)
  ) {
    throw new Error("Invalid codex config");
  }
  if (
    !config.limits ||
    config.limits.maxActiveSessions < 1 ||
    config.limits.maxActiveTasks < 1 ||
    config.limits.maxLogBytesPerSession < 1024
  ) {
    throw new Error("Invalid limits config");
  }
  if (
    !config.sessions ||
    config.sessions.autoArchiveStoppedAfterMinutes < 0 ||
    config.sessions.deleteArchivedAfterDays < 0
  ) {
    throw new Error("Invalid sessions config");
  }
}

function normalizeCodexModels(models: CodexModelConfig[] | undefined): CodexModelConfig[] {
  if (!Array.isArray(models) || models.length === 0) {
    return DEFAULT_CODEX_MODELS;
  }
  const seen = new Set<string>();
  const normalized: CodexModelConfig[] = [];
  for (const model of models) {
    const id = typeof model?.id === "string" ? model.id.trim() : "";
    const label = typeof model?.label === "string" ? model.label.trim() : "";
    if (!id || !label || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({ id, label });
  }
  return normalized.length ? normalized : DEFAULT_CODEX_MODELS;
}

function normalizeDefaultModel(defaultModel: string | undefined, models: CodexModelConfig[]): string {
  const candidate = typeof defaultModel === "string" ? defaultModel.trim() : "";
  if (candidate && models.some((model) => model.id === candidate)) {
    return candidate;
  }
  return models[0].id;
}

function normalizeCodexReasoningEfforts(
  efforts: CodexReasoningEffortConfig[] | undefined
): CodexReasoningEffortConfig[] {
  if (!Array.isArray(efforts) || efforts.length === 0) {
    return DEFAULT_CODEX_REASONING_EFFORTS;
  }
  const seen = new Set<CodexReasoningEffort>();
  const normalized: CodexReasoningEffortConfig[] = [];
  for (const effort of efforts) {
    const id = typeof effort?.id === "string" ? effort.id.trim() : "";
    const label = typeof effort?.label === "string" ? effort.label.trim() : "";
    if (!isCodexReasoningEffort(id) || !label || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({ id, label });
  }
  return normalized.length ? normalized : DEFAULT_CODEX_REASONING_EFFORTS;
}

function normalizeDefaultReasoningEffort(
  defaultReasoningEffort: string | undefined,
  efforts: CodexReasoningEffortConfig[]
): CodexReasoningEffort {
  const candidate = typeof defaultReasoningEffort === "string" ? defaultReasoningEffort.trim() : "";
  if (isCodexReasoningEffort(candidate) && efforts.some((effort) => effort.id === candidate)) {
    return candidate;
  }
  return (
    efforts.find((effort) => effort.id === DEFAULT_CODEX_REASONING_EFFORT)?.id ??
    efforts[0]?.id ??
    DEFAULT_CODEX_REASONING_EFFORT
  );
}

function isCodexReasoningEffort(value: string): value is CodexReasoningEffort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function normalizeCodexPermissionModes(
  modes: CodexPermissionModeConfig[] | undefined
): CodexPermissionModeConfig[] {
  if (!Array.isArray(modes) || modes.length === 0) {
    return DEFAULT_CODEX_PERMISSION_MODES;
  }
  const seen = new Set<CodexPermissionMode>();
  const normalized: CodexPermissionModeConfig[] = [];
  for (const mode of modes) {
    const id = typeof mode?.id === "string" ? mode.id.trim() : "";
    const label = typeof mode?.label === "string" ? mode.label.trim() : "";
    const description = typeof mode?.description === "string" ? mode.description.trim() : "";
    const approvalPolicy = typeof mode?.approvalPolicy === "string" ? mode.approvalPolicy.trim() : "";
    const approvalsReviewer = typeof mode?.approvalsReviewer === "string" ? mode.approvalsReviewer.trim() : "";
    const sandbox = typeof mode?.sandbox === "string" ? mode.sandbox.trim() : "";
    if (
      !isCodexPermissionMode(id) ||
      !label ||
      !description ||
      !isCodexApprovalPolicy(approvalPolicy) ||
      !isCodexApprovalsReviewer(approvalsReviewer) ||
      !isCodexSandboxMode(sandbox) ||
      seen.has(id)
    ) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      label,
      description,
      approvalPolicy,
      approvalsReviewer,
      sandbox,
      highRisk: mode.highRisk === true
    });
  }
  return normalized.length ? normalized : DEFAULT_CODEX_PERMISSION_MODES;
}

function normalizeDefaultPermissionMode(
  defaultPermissionMode: string | undefined,
  modes: CodexPermissionModeConfig[]
): CodexPermissionMode {
  const candidate = typeof defaultPermissionMode === "string" ? defaultPermissionMode.trim() : "";
  if (isCodexPermissionMode(candidate) && modes.some((mode) => mode.id === candidate)) {
    return candidate;
  }
  return (
    modes.find((mode) => mode.id === DEFAULT_CODEX_PERMISSION_MODE)?.id ??
    modes[0]?.id ??
    DEFAULT_CODEX_PERMISSION_MODE
  );
}

function isCodexPermissionMode(value: string): value is CodexPermissionMode {
  return value === "default" || value === "auto-review" || value === "full-access";
}

function isCodexApprovalPolicy(value: string): value is CodexApprovalPolicy {
  return value === "untrusted" || value === "on-failure" || value === "on-request" || value === "never";
}

function isCodexApprovalsReviewer(value: string): value is CodexApprovalsReviewer {
  return value === "user" || value === "auto_review" || value === "guardian_subagent";
}

function isCodexSandboxMode(value: string): value is CodexSandboxMode {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access";
}
