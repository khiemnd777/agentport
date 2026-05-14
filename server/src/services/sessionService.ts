import path from "node:path";
import type { AppConfig } from "../config";
import type {
  CodexSession,
  CodexRunProfile,
  ControlState,
  ControlMode,
  PublicCodexSession,
  SessionSource,
  SyncStatus,
  TerminalStatus,
  WaitingUserInput
} from "../domain/sessionTypes";
import type { TaskStatus } from "../domain/taskTypes";
import { deleteFileIfExists, listJsonFiles, readJsonFile, writeJsonFile, ensureDir } from "../utils/fileStore";
import { createId, nowIso } from "../utils/ids";
import { badRequest, conflict, notFound } from "../utils/httpErrors";
import { asCursorRecord, decodePageCursor, encodePageCursor, type CursorPage } from "../utils/pagination";
import { validateBranchName, validateSessionId } from "../utils/validation";
import type { RepoRegistry } from "./repoRegistry";
import type { EventStore } from "./eventStore";
import type { GitService } from "./gitService";

export class SessionService {
  private readonly sessions = new Map<string, CodexSession>();
  private readonly forgottenCodexThreadIds = new Set<string>();
  private readonly sessionsDir: string;
  private readonly forgottenCodexThreadsPath: string;

  constructor(
    dataRoot: string,
    private readonly config: AppConfig,
    private readonly repoRegistry: RepoRegistry,
    private readonly eventStore: EventStore,
    private readonly gitService: GitService
  ) {
    this.sessionsDir = path.join(dataRoot, "sessions");
    this.forgottenCodexThreadsPath = path.join(dataRoot, "codex", "forgotten-threads.json");
  }

  async init(): Promise<void> {
    await ensureDir(this.sessionsDir);
    const forgotten = await readJsonFile<string[]>(this.forgottenCodexThreadsPath);
    for (const threadId of forgotten ?? []) {
      if (typeof threadId === "string" && threadId) {
        this.forgottenCodexThreadIds.add(threadId);
      }
    }
    const sessions = await listJsonFiles<CodexSession>(this.sessionsDir);
    for (const session of sessions) {
      let needsSave = false;
      if ((session as Partial<CodexSession>).archived_at === undefined) {
        session.archived_at = null;
        needsSave = true;
      }
      if ((session as Partial<CodexSession>).codex_thread_id === undefined) {
        session.codex_thread_id = null;
        needsSave = true;
      }
      if ((session as Partial<CodexSession>).waiting_user_input === undefined) {
        session.waiting_user_input = null;
        needsSave = true;
      }
      if ((session as Partial<CodexSession>).sync_status === undefined) {
        session.sync_status = session.codex_thread_id ? "synced" : "local_only";
        needsSave = true;
      }
      if ((session as Partial<CodexSession>).control_state === undefined) {
        session.control_state = session.codex_thread_id ? "idle" : "observing";
        needsSave = true;
      }
      if ((session as Partial<CodexSession>).last_synced_at === undefined) {
        session.last_synced_at = null;
        needsSave = true;
      }
      if ((session as Partial<CodexSession>).last_sync_error === undefined) {
        session.last_sync_error = null;
        needsSave = true;
      }
      if ((session as Partial<CodexSession>).codex_thread_updated_at === undefined) {
        session.codex_thread_updated_at = null;
        needsSave = true;
      }
      const normalizedRunProfile = normalizeRunProfile(this.config, (session as Partial<CodexSession>).run_profile, session.updated_at);
      if (!runProfilesEqual((session as Partial<CodexSession>).run_profile, normalizedRunProfile)) {
        session.run_profile = normalizedRunProfile;
        needsSave = true;
      }
      if (!["CLOSED", "ERROR"].includes(session.terminal_status)) {
        session.terminal_status = "DISCONNECTED";
        session.updated_at = nowIso();
        needsSave = true;
      }
      if (["CREATED", "RUNNING", "WAITING_FOR_USER"].includes(session.task_status)) {
        session.task_status = "CANCELLED";
        session.active_task_id = null;
        session.waiting_user_input = null;
        session.updated_at = nowIso();
        needsSave = true;
      }
      if (session.task_status !== "WAITING_FOR_USER" && session.waiting_user_input) {
        session.waiting_user_input = null;
        session.updated_at = nowIso();
        needsSave = true;
      }
      if (needsSave) {
        await this.save(session);
      }
      this.sessions.set(session.id, session);
    }
  }

  list(options: { includeArchived?: boolean; view?: SessionListView } = {}): CodexSession[] {
    const view = options.view ?? (options.includeArchived ? "all" : "active");
    return [...this.sessions.values()]
      .filter((session) => {
        if (view === "all") {
          return true;
        }
        if (view === "archived") {
          return Boolean(session.archived_at);
        }
        return !session.archived_at;
      })
      .sort(compareSessionsForList);
  }

  listPublic(options: { includeArchived?: boolean; view?: SessionListView } = {}): PublicCodexSession[] {
    return this.list(options).map(toPublicSession);
  }

  listPublicPage(
    options: { includeArchived?: boolean; view?: SessionListView; limit: number; cursor?: string | null }
  ): CursorPage<PublicCodexSession> {
    const cursor = decodeSessionListCursor(options.cursor);
    const candidates = this.list(options).filter((session) => !cursor || isSessionAfterCursor(session, cursor));
    const pageItems = candidates.slice(0, options.limit + 1);
    const hasMore = pageItems.length > options.limit;
    const sessions = pageItems.slice(0, options.limit);
    const last = sessions.at(-1);
    return {
      items: sessions.map(toPublicSession),
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeSessionListCursor(last) : null
    };
  }

  get(id: string): CodexSession {
    validateSessionId(id);
    const session = this.sessions.get(id);
    if (!session) {
      throw notFound("Session not found");
    }
    return session;
  }

  getPublic(id: string): PublicCodexSession {
    return toPublicSession(this.get(id));
  }

  countActiveTerminalSessions(): number {
    return this.list().filter((session) => ["CONNECTING", "CONNECTED", "RUNNING"].includes(session.terminal_status)).length;
  }

  async create(input: {
    repo_key: string;
    branch_name?: string | null;
    title?: string;
    source: SessionSource;
    control_mode: ControlMode;
  }): Promise<CodexSession> {
    if (this.countActiveTerminalSessions() >= this.config.limits.maxActiveSessions) {
      throw conflict("Maximum active sessions reached");
    }
    const repo = this.repoRegistry.getRepo(input.repo_key);
    const requestedBranch = validateBranchName(input.branch_name);
    const currentBranch = await this.gitService.getCurrentBranch(repo.path).catch(() => null);
    const now = nowIso();
    const session: CodexSession = {
      id: createId(),
      repo_key: repo.key,
      repo_path: repo.path,
      branch_name: requestedBranch ?? currentBranch,
      title: input.title?.trim() || `${repo.label} session`,
      source: input.source,
      control_mode: input.control_mode,
      terminal_status: "CONNECTING",
      task_status: "IDLE",
      active_task_id: null,
      codex_thread_id: null,
      sync_status: "local_only",
      control_state: "observing",
      last_synced_at: null,
      last_sync_error: null,
      codex_thread_updated_at: null,
      run_profile: defaultRunProfile(this.config, now),
      waiting_user_input: null,
      created_at: now,
      updated_at: now,
      started_at: null,
      closed_at: null,
      last_output_at: null,
      archived_at: null
    };
    this.sessions.set(session.id, session);
    await this.save(session);
    await this.eventStore.append({
      session_id: session.id,
      event_type: "session_created",
      summary: `Session created for ${repo.key}`,
      metadata: { repo_key: repo.key, source: session.source, control_mode: session.control_mode }
    });
    return session;
  }

  findByCodexThreadId(codexThreadId: string): CodexSession | null {
    return [...this.sessions.values()].find((session) => session.codex_thread_id === codexThreadId) ?? null;
  }

  isCodexThreadForgotten(codexThreadId: string): boolean {
    return this.forgottenCodexThreadIds.has(codexThreadId);
  }

  async forgetCodexThread(codexThreadId: string | null): Promise<void> {
    if (!codexThreadId || this.forgottenCodexThreadIds.has(codexThreadId)) {
      return;
    }
    this.forgottenCodexThreadIds.add(codexThreadId);
    await this.saveForgottenCodexThreads();
  }

  async unforgetCodexThread(codexThreadId: string | null): Promise<void> {
    if (!codexThreadId || !this.forgottenCodexThreadIds.has(codexThreadId)) {
      return;
    }
    this.forgottenCodexThreadIds.delete(codexThreadId);
    await this.saveForgottenCodexThreads();
  }

  async importCodexThread(input: {
    repo_key: string;
    title?: string | null;
    codex_thread_id: string;
    codex_thread_updated_at: string | null;
    control_state: ControlState;
    sync_status?: SyncStatus;
    created_at?: string | null;
    restore?: boolean;
  }): Promise<CodexSession> {
    const existing = this.findByCodexThreadId(input.codex_thread_id);
    if (existing) {
      const nextTitle = input.title?.trim() || existing.title;
      const nextSyncStatus = input.sync_status ?? "synced";
      const shouldRestore = input.restore === true && existing.archived_at !== null;
      const changed =
        existing.title !== nextTitle ||
        existing.sync_status !== nextSyncStatus ||
        existing.control_state !== input.control_state ||
        existing.last_sync_error !== null ||
        existing.codex_thread_updated_at !== input.codex_thread_updated_at ||
        existing.last_synced_at === null ||
        shouldRestore;
      if (!changed) {
        return existing;
      }
      existing.title = nextTitle;
      existing.sync_status = nextSyncStatus;
      existing.control_state = input.control_state;
      existing.last_synced_at = nowIso();
      existing.last_sync_error = null;
      existing.codex_thread_updated_at = input.codex_thread_updated_at;
      if (shouldRestore) {
        existing.archived_at = null;
        existing.updated_at = existing.last_synced_at;
      }
      await this.save(existing);
      return existing;
    }

    const repo = this.repoRegistry.getRepo(input.repo_key);
    const currentBranch = await this.gitService.getCurrentBranch(repo.path).catch(() => null);
    const now = nowIso();
    const session: CodexSession = {
      id: createId(),
      repo_key: repo.key,
      repo_path: repo.path,
      branch_name: currentBranch,
      title: input.title?.trim() || `${repo.label} Codex thread`,
      source: "codex_desktop",
      control_mode: "web_managed",
      terminal_status: "DISCONNECTED",
      task_status: input.control_state === "desktop_active" ? "RUNNING" : "IDLE",
      active_task_id: null,
      codex_thread_id: input.codex_thread_id,
      sync_status: input.sync_status ?? "synced",
      control_state: input.control_state,
      last_synced_at: now,
      last_sync_error: null,
      codex_thread_updated_at: input.codex_thread_updated_at,
      run_profile: defaultRunProfile(this.config, now),
      waiting_user_input: null,
      created_at: input.created_at ?? now,
      updated_at: now,
      started_at: null,
      closed_at: null,
      last_output_at: null,
      archived_at: null
    };
    this.sessions.set(session.id, session);
    await this.save(session);
    await this.eventStore.append({
      session_id: session.id,
      event_type: "session_created",
      summary: `Codex thread imported for ${repo.key}`,
      metadata: { repo_key: repo.key, source: session.source, control_mode: session.control_mode }
    });
    return session;
  }

  async updateRunProfile(
    id: string,
    input: {
      model?: unknown;
      reasoning_effort?: unknown;
      permission_mode?: unknown;
      plan_mode?: unknown;
    }
  ): Promise<CodexSession> {
    const session = this.get(id);
    const current = normalizeRunProfile(this.config, session.run_profile, session.updated_at);
    const next: CodexRunProfile = {
      model: resolveRunProfileModel(this.config, input.model, current.model),
      reasoning_effort: resolveRunProfileReasoningEffort(this.config, input.reasoning_effort, current.reasoning_effort),
      permission_mode: resolveRunProfilePermissionMode(this.config, input.permission_mode, current.permission_mode),
      plan_mode: resolveRunProfilePlanMode(input.plan_mode, current.plan_mode),
      updated_at: current.updated_at
    };

    if (runProfilesEqual(current, next)) {
      if (!runProfilesEqual(session.run_profile, current)) {
        session.run_profile = current;
        await this.save(session);
      }
      return session;
    }

    next.updated_at = nowIso();
    session.run_profile = next;
    await this.save(session);
    return session;
  }

  async updateTerminalStatus(id: string, terminalStatus: TerminalStatus): Promise<CodexSession> {
    const session = this.get(id);
    const now = nowIso();
    session.terminal_status = terminalStatus;
    session.updated_at = now;
    if (terminalStatus === "RUNNING" && !session.started_at) {
      session.started_at = now;
    }
    if (terminalStatus === "CLOSED" && !session.closed_at) {
      session.closed_at = now;
    }
    await this.save(session);
    return session;
  }

  async archive(id: string): Promise<CodexSession> {
    const session = this.get(id);
    if (["CONNECTING", "CONNECTED", "RUNNING"].includes(session.terminal_status)) {
      throw conflict("Close or disconnect the session before archiving it");
    }
    if (!session.archived_at) {
      session.archived_at = nowIso();
      session.updated_at = session.archived_at;
      await this.save(session);
    }
    return session;
  }

  async archiveStoppedOlderThan(minutes: number): Promise<CodexSession[]> {
    const archived: CodexSession[] = [];
    const thresholdMs = Date.now() - minutes * 60 * 1000;
    for (const session of this.sessions.values()) {
      if (session.archived_at) {
        continue;
      }
      const archiveReference = getAutoArchiveReferenceTime(session);
      if (archiveReference && Date.parse(archiveReference) <= thresholdMs) {
        archived.push(await this.archive(session.id));
      }
    }
    return archived;
  }

  listArchivedExpiredForDeletion(days: number): CodexSession[] {
    if (days <= 0) {
      return [];
    }
    const thresholdMs = Date.now() - days * 24 * 60 * 60 * 1000;
    return [...this.sessions.values()].filter(
      (session) => session.archived_at && Date.parse(session.archived_at) <= thresholdMs
    );
  }

  async delete(id: string): Promise<CodexSession> {
    const session = this.get(id);
    if (["CONNECTING", "CONNECTED", "RUNNING"].includes(session.terminal_status)) {
      throw conflict("Close the session before deleting it");
    }
    this.sessions.delete(id);
    await deleteFileIfExists(path.join(this.sessionsDir, `${id}.json`));
    return session;
  }

  async setTaskState(id: string, taskStatus: TaskStatus, activeTaskId: string | null): Promise<CodexSession> {
    const session = this.get(id);
    session.task_status = taskStatus;
    session.active_task_id = activeTaskId;
    if (taskStatus !== "WAITING_FOR_USER") {
      session.waiting_user_input = null;
    }
    session.updated_at = nowIso();
    await this.save(session);
    return session;
  }

  async setWaitingUserInput(
    id: string,
    waitingUserInput: WaitingUserInput,
    activeTaskId: string | null
  ): Promise<CodexSession> {
    const session = this.get(id);
    session.task_status = "WAITING_FOR_USER";
    session.active_task_id = activeTaskId;
    session.waiting_user_input = waitingUserInput;
    session.updated_at = nowIso();
    await this.save(session);
    return session;
  }

  async setCodexThreadId(id: string, codexThreadId: string): Promise<CodexSession> {
    const session = this.get(id);
    if (session.codex_thread_id === codexThreadId) {
      return session;
    }
    session.codex_thread_id = codexThreadId;
    session.sync_status = "syncing";
    session.control_state = "mobile_control";
    session.updated_at = nowIso();
    await this.save(session);
    return session;
  }

  async setSyncState(
    id: string,
    input: {
      sync_status: SyncStatus;
      control_state?: ControlState;
      last_sync_error?: string | null;
      codex_thread_updated_at?: string | null;
      task_status?: TaskStatus;
    }
  ): Promise<CodexSession> {
    const session = this.get(id);
    const now = nowIso();
    const nextControlState = input.control_state ?? session.control_state;
    const nextLastSyncError = input.last_sync_error ?? null;
    const nextCodexThreadUpdatedAt =
      input.codex_thread_updated_at === undefined ? session.codex_thread_updated_at : input.codex_thread_updated_at;
    const nextTaskStatus = input.task_status ?? session.task_status;
    const shouldClearWaitingInput = input.task_status !== undefined && input.task_status !== "WAITING_FOR_USER";
    const changed =
      session.sync_status !== input.sync_status ||
      session.control_state !== nextControlState ||
      session.last_sync_error !== nextLastSyncError ||
      session.codex_thread_updated_at !== nextCodexThreadUpdatedAt ||
      session.task_status !== nextTaskStatus ||
      (shouldClearWaitingInput && session.waiting_user_input !== null);
    const shouldSetLastSyncedAt = input.sync_status === "synced" && (changed || session.last_synced_at === null);

    if (!changed && !shouldSetLastSyncedAt) {
      return session;
    }

    session.sync_status = input.sync_status;
    session.control_state = nextControlState;
    if (shouldSetLastSyncedAt) {
      session.last_synced_at = now;
    }
    session.last_sync_error = nextLastSyncError;
    session.codex_thread_updated_at = nextCodexThreadUpdatedAt;
    if (input.task_status) {
      session.task_status = input.task_status;
      if (input.task_status !== "WAITING_FOR_USER") {
        session.waiting_user_input = null;
      }
    }
    await this.save(session);
    return session;
  }

  async touchOutput(id: string): Promise<CodexSession> {
    const session = this.get(id);
    const now = nowIso();
    session.last_output_at = now;
    session.updated_at = now;
    await this.save(session);
    return session;
  }

  async save(session: CodexSession): Promise<void> {
    await writeJsonFile(path.join(this.sessionsDir, `${session.id}.json`), session);
  }

  private async saveForgottenCodexThreads(): Promise<void> {
    await writeJsonFile(this.forgottenCodexThreadsPath, [...this.forgottenCodexThreadIds].sort());
  }
}

export function toPublicSession(session: CodexSession): PublicCodexSession {
  const { repo_path: _repoPath, ...publicSession } = session;
  return publicSession;
}

export function isStoppedTerminalStatus(status: TerminalStatus): boolean {
  return ["DISCONNECTED", "CLOSED", "ERROR"].includes(status);
}

export type SessionListView = "active" | "archived" | "all";

interface SessionListCursor {
  updated_at: string;
  id: string;
}

function compareSessionsForList(a: CodexSession, b: CodexSession): number {
  const updatedCompare = b.updated_at.localeCompare(a.updated_at);
  return updatedCompare || b.id.localeCompare(a.id);
}

function isSessionAfterCursor(session: CodexSession, cursor: SessionListCursor): boolean {
  const updatedCompare = session.updated_at.localeCompare(cursor.updated_at);
  if (updatedCompare !== 0) {
    return updatedCompare < 0;
  }
  return session.id.localeCompare(cursor.id) < 0;
}

function encodeSessionListCursor(session: CodexSession): string {
  return encodePageCursor({ updated_at: session.updated_at, id: session.id });
}

function decodeSessionListCursor(value: string | null | undefined): SessionListCursor | null {
  const record = asCursorRecord(decodePageCursor(value));
  if (!record) {
    return null;
  }
  if (typeof record.updated_at !== "string" || typeof record.id !== "string") {
    throw badRequest("Invalid sessions cursor");
  }
  return { updated_at: record.updated_at, id: record.id };
}

function defaultRunProfile(config: AppConfig, updatedAt: string): CodexRunProfile {
  return {
    model: config.codex.defaultModel,
    reasoning_effort: config.codex.defaultReasoningEffort,
    permission_mode: config.codex.defaultPermissionMode,
    plan_mode: false,
    updated_at: updatedAt
  };
}

function normalizeRunProfile(
  config: AppConfig,
  value: Partial<CodexRunProfile> | undefined,
  fallbackUpdatedAt: string
): CodexRunProfile {
  const defaults = defaultRunProfile(config, fallbackUpdatedAt);
  const model = value?.model;
  const reasoningEffort = value?.reasoning_effort;
  const permissionMode = value?.permission_mode;
  return {
    model: isSupportedRunProfileModel(config, model) ? model : defaults.model,
    reasoning_effort: isSupportedRunProfileReasoningEffort(config, reasoningEffort)
      ? reasoningEffort
      : defaults.reasoning_effort,
    permission_mode: isSupportedRunProfilePermissionMode(config, permissionMode)
      ? permissionMode
      : defaults.permission_mode,
    plan_mode: typeof value?.plan_mode === "boolean" ? value.plan_mode : defaults.plan_mode,
    updated_at: typeof value?.updated_at === "string" && value.updated_at ? value.updated_at : defaults.updated_at
  };
}

function isSupportedRunProfileModel(config: AppConfig, value: unknown): value is string {
  return typeof value === "string" && config.codex.models.some((model) => model.id === value);
}

function resolveRunProfileModel(config: AppConfig, value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (!isSupportedRunProfileModel(config, value)) {
    throw badRequest("Unsupported Codex model");
  }
  return value;
}

function isSupportedRunProfileReasoningEffort(
  config: AppConfig,
  value: unknown
): value is CodexRunProfile["reasoning_effort"] {
  return typeof value === "string" && config.codex.reasoningEfforts.some((effort) => effort.id === value);
}

function resolveRunProfileReasoningEffort(
  config: AppConfig,
  value: unknown,
  fallback: CodexRunProfile["reasoning_effort"]
): CodexRunProfile["reasoning_effort"] {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (!isSupportedRunProfileReasoningEffort(config, value)) {
    throw badRequest("Unsupported Codex reasoning effort");
  }
  return value;
}

function isSupportedRunProfilePermissionMode(
  config: AppConfig,
  value: unknown
): value is CodexRunProfile["permission_mode"] {
  return typeof value === "string" && config.codex.permissionModes.some((mode) => mode.id === value);
}

function resolveRunProfilePermissionMode(
  config: AppConfig,
  value: unknown,
  fallback: CodexRunProfile["permission_mode"]
): CodexRunProfile["permission_mode"] {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (!isSupportedRunProfilePermissionMode(config, value)) {
    throw badRequest("Unsupported Codex permission mode");
  }
  return value;
}

function resolveRunProfilePlanMode(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw badRequest("Invalid plan_mode");
  }
  return value;
}

function runProfilesEqual(a: Partial<CodexRunProfile> | undefined, b: Partial<CodexRunProfile> | undefined): boolean {
  return (
    a?.model === b?.model &&
    a?.reasoning_effort === b?.reasoning_effort &&
    a?.permission_mode === b?.permission_mode &&
    a?.plan_mode === b?.plan_mode &&
    a?.updated_at === b?.updated_at
  );
}

function getAutoArchiveReferenceTime(session: CodexSession): string | null {
  if (session.codex_thread_id) {
    if (session.control_state === "desktop_active" || session.control_state === "mobile_control") {
      return null;
    }
    return session.codex_thread_updated_at ?? session.last_synced_at ?? session.closed_at ?? session.last_output_at ?? session.updated_at;
  }
  if (!isStoppedTerminalStatus(session.terminal_status)) {
    return null;
  }
  return session.closed_at ?? session.last_output_at ?? session.updated_at;
}
