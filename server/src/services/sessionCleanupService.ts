import type { AppConfig } from "../config";
import type { PtySessionManager } from "../pty/PtySessionManager";
import type { EventStore } from "./eventStore";
import type { LogStore } from "./logStore";
import type { SessionService } from "./sessionService";
import type { TaskService } from "./taskService";
import type { CodexChatService } from "./codexChatService";

export class SessionCleanupService {
  constructor(
    private readonly config: AppConfig,
    private readonly sessionService: SessionService,
    private readonly taskService: TaskService,
    private readonly codexChatService: CodexChatService,
    private readonly eventStore: EventStore,
    private readonly logStore: LogStore,
    private readonly ptySessionManager: PtySessionManager
  ) {}

  async sweep(): Promise<void> {
    const archived = await this.sessionService.archiveStoppedOlderThan(
      this.config.sessions.autoArchiveStoppedAfterMinutes
    );
    for (const session of archived) {
      await this.eventStore.append({
        session_id: session.id,
        event_type: "session_archived",
        summary: "Session auto-archived by retention policy",
        metadata: {
          autoArchiveStoppedAfterMinutes: this.config.sessions.autoArchiveStoppedAfterMinutes
        }
      });
    }

    const expired = this.sessionService.listArchivedExpiredForDeletion(
      this.config.sessions.deleteArchivedAfterDays
    );
    for (const session of expired) {
      await this.delete(session.id);
    }
  }

  async archive(sessionId: string): Promise<void> {
    const session = await this.sessionService.archive(sessionId);
    await this.eventStore.append({
      session_id: session.id,
      event_type: "session_archived",
      summary: "Session archived",
      metadata: {}
    });
  }

  async delete(sessionId: string): Promise<void> {
    const sessionForDelete = this.sessionService.get(sessionId);
    await this.sessionService.forgetCodexThread(sessionForDelete.codex_thread_id);
    await this.taskService.cancelActiveTaskForSession(sessionId);
    if (this.ptySessionManager.hasActiveSession(sessionId)) {
      await this.ptySessionManager.closeSession(sessionId);
    } else {
      const session = this.sessionService.get(sessionId);
      if (["CONNECTING", "CONNECTED", "RUNNING"].includes(session.terminal_status)) {
        await this.sessionService.updateTerminalStatus(sessionId, "DISCONNECTED");
      }
    }
    await this.taskService.deleteForSession(sessionId);
    await this.codexChatService.deleteForSession(sessionId);
    await this.logStore.delete(sessionId);
    await this.eventStore.deleteSessionEvents(sessionId);
    await this.sessionService.delete(sessionId);
  }
}
