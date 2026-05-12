import path from "node:path";
import type { AppConfig } from "../config";
import type {
  CodexSession,
  ControlMode,
  PublicCodexSession,
  SessionSource,
  TerminalStatus,
  WaitingUserInput
} from "../domain/sessionTypes";
import type { TaskStatus } from "../domain/taskTypes";
import { deleteFileIfExists, listJsonFiles, writeJsonFile, ensureDir } from "../utils/fileStore";
import { createId, nowIso } from "../utils/ids";
import { conflict, notFound } from "../utils/httpErrors";
import { validateBranchName, validateSessionId } from "../utils/validation";
import type { RepoRegistry } from "./repoRegistry";
import type { EventStore } from "./eventStore";
import type { GitService } from "./gitService";

export class SessionService {
  private readonly sessions = new Map<string, CodexSession>();
  private readonly sessionsDir: string;

  constructor(
    dataRoot: string,
    private readonly config: AppConfig,
    private readonly repoRegistry: RepoRegistry,
    private readonly eventStore: EventStore,
    private readonly gitService: GitService
  ) {
    this.sessionsDir = path.join(dataRoot, "sessions");
  }

  async init(): Promise<void> {
    await ensureDir(this.sessionsDir);
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

  list(options: { includeArchived?: boolean } = {}): CodexSession[] {
    return [...this.sessions.values()]
      .filter((session) => options.includeArchived || !session.archived_at)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  listPublic(options: { includeArchived?: boolean } = {}): PublicCodexSession[] {
    return this.list(options).map(toPublicSession);
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
      if (session.archived_at || !isStoppedTerminalStatus(session.terminal_status)) {
        continue;
      }
      const stoppedAt = session.closed_at ?? session.last_output_at ?? session.updated_at;
      if (Date.parse(stoppedAt) <= thresholdMs) {
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
    session.updated_at = nowIso();
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
}

export function toPublicSession(session: CodexSession): PublicCodexSession {
  const { repo_path: _repoPath, ...publicSession } = session;
  return publicSession;
}

export function isStoppedTerminalStatus(status: TerminalStatus): boolean {
  return ["DISCONNECTED", "CLOSED", "ERROR"].includes(status);
}
