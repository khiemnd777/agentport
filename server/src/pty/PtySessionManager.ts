import type { AppConfig } from "../config";
import type { CodexSession } from "../domain/sessionTypes";
import { conflict, notFound } from "../utils/httpErrors";
import type { EventStore } from "../services/eventStore";
import type { LogStore } from "../services/logStore";
import type { SessionService } from "../services/sessionService";
import type { TaskService } from "../services/taskService";
import { CodexPtySession } from "./CodexPtySession";

interface TerminalSocketData {
  sessionId: string;
}

type TerminalWebSocket = Bun.ServerWebSocket<TerminalSocketData>;

const TERMINAL_REPLAY_BYTES = 256 * 1024;

export class PtySessionManager {
  private readonly ptySessions = new Map<string, CodexPtySession>();
  private readonly clients = new Map<string, Set<TerminalWebSocket>>();
  private readonly sessionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly closingSessions = new Set<string>();

  constructor(
    private readonly config: AppConfig,
    private readonly sessionService: SessionService,
    private readonly taskService: TaskService,
    private readonly eventStore: EventStore,
    private readonly logStore: LogStore
  ) {}

  getActiveCount(): number {
    return this.ptySessions.size;
  }

  hasActiveSession(sessionId: string): boolean {
    return this.ptySessions.has(sessionId);
  }

  async startSession(session: CodexSession): Promise<void> {
    if (this.ptySessions.size >= this.config.limits.maxActiveSessions) {
      throw conflict("Maximum active sessions reached");
    }
    const ptySession = new CodexPtySession({
      sessionId: session.id,
      command: this.config.codex.command,
      args: this.config.codex.defaultArgs,
      cwd: session.repo_path,
      onData: (chunk) => {
        void this.handleOutput(session.id, chunk);
      },
      onExit: (exitCode, signal) => {
        void this.handleExit(session.id, exitCode, signal);
      }
    });
    ptySession.start();
    this.ptySessions.set(session.id, ptySession);
    this.scheduleSessionTimeout(session.id);
    await this.sessionService.updateTerminalStatus(session.id, "RUNNING");
    await this.eventStore.append({
      session_id: session.id,
      event_type: "session_started",
      summary: "Codex PTY session started",
      metadata: { command: this.config.codex.command }
    });
    this.broadcastStatus(session.id);
  }

  async attachClient(sessionId: string, ws: TerminalWebSocket): Promise<void> {
    const session = this.sessionService.get(sessionId);
    if (!this.clients.has(sessionId)) {
      this.clients.set(sessionId, new Set());
    }
    this.clients.get(sessionId)?.add(ws);

    const hasActivePty = this.ptySessions.has(sessionId);
    if (!hasActivePty && ["CONNECTING", "CONNECTED", "RUNNING"].includes(session.terminal_status)) {
      await this.sessionService.updateTerminalStatus(sessionId, "DISCONNECTED");
      session.terminal_status = "DISCONNECTED";
    }

    await this.eventStore.append({
      session_id: sessionId,
      event_type: "session_connected",
      summary: "Browser terminal connected",
      metadata: {}
    });
    ws.send(
      JSON.stringify({
        type: "status",
        sessionId,
        terminalStatus: session.terminal_status,
        taskStatus: session.task_status
      })
    );

    if (hasActivePty) {
      const replay = await this.logStore.readTail(sessionId, TERMINAL_REPLAY_BYTES);
      if (replay) {
        ws.send(JSON.stringify({ type: "output", sessionId, data: replay, replay: true }));
      }
    } else {
      ws.send(
        JSON.stringify({
          type: "error",
          sessionId,
          code: "PTY_UNAVAILABLE",
          message:
            session.terminal_status === "DISCONNECTED"
              ? "This session is not attached to a live Codex process. Raw Codex TUI history is not replayed here because it cannot be rendered reliably after the PTY has stopped. Create a new session to start a fresh console."
              : "This session is closed. Raw Codex TUI history is not replayed here because it cannot be rendered reliably after the PTY has stopped."
        })
      );
    }
  }

  async detachClient(sessionId: string, ws: TerminalWebSocket): Promise<void> {
    const clients = this.clients.get(sessionId);
    clients?.delete(ws);
    if (clients?.size === 0) {
      this.clients.delete(sessionId);
      await this.eventStore.append({
        session_id: sessionId,
        event_type: "session_disconnected",
        summary: "Browser terminal disconnected",
        metadata: {}
      });
    }
  }

  async writeFromClient(sessionId: string, input: string): Promise<void> {
    const session = this.sessionService.get(sessionId);
    if (session.control_mode !== "web_managed") {
      throw conflict("This session is controlled from the local terminal. Remote input is disabled.");
    }
    const ptySession = this.ptySessions.get(sessionId);
    if (!ptySession) {
      throw notFound("Active PTY session not found");
    }
    ptySession.write(input);
    this.scheduleSessionTimeout(sessionId);
    await this.eventStore.append({
      session_id: sessionId,
      task_id: session.active_task_id ?? undefined,
      event_type: "terminal_input",
      summary: "Terminal input sent from browser",
      metadata: { bytes: input.length }
    });
  }

  async writeTaskPrompt(sessionId: string, prompt: string): Promise<void> {
    const ptySession = this.ptySessions.get(sessionId);
    if (!ptySession) {
      throw notFound("Active PTY session not found");
    }
    ptySession.write(`\x1b[200~${prompt}\x1b[201~\r`);
    this.scheduleSessionTimeout(sessionId);
  }

  async interruptSession(sessionId: string): Promise<void> {
    const ptySession = this.ptySessions.get(sessionId);
    if (!ptySession) {
      return;
    }
    ptySession.write("\x03");
    this.scheduleSessionTimeout(sessionId);
    const session = this.sessionService.get(sessionId);
    await this.eventStore.append({
      session_id: sessionId,
      task_id: session.active_task_id ?? undefined,
      event_type: "terminal_input",
      summary: "Interrupt sent to Codex PTY",
      metadata: { signal: "SIGINT" }
    });
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const ptySession = this.ptySessions.get(sessionId);
    ptySession?.resize(cols, rows);
    if (ptySession) {
      this.scheduleSessionTimeout(sessionId);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const ptySession = this.ptySessions.get(sessionId);
    this.closingSessions.add(sessionId);
    ptySession?.close();
    this.ptySessions.delete(sessionId);
    this.clearSessionTimeout(sessionId);
    await this.sessionService.updateTerminalStatus(sessionId, "CLOSED");
    await this.eventStore.append({
      session_id: sessionId,
      event_type: "session_closed",
      summary: "Session closed",
      metadata: {}
    });
    this.broadcastStatus(sessionId);
  }

  broadcastStatus(sessionId: string): void {
    const session = this.sessionService.get(sessionId);
    this.broadcast(sessionId, {
      type: "status",
      sessionId,
      terminalStatus: session.terminal_status,
      taskStatus: session.task_status
    });
  }

  private async handleOutput(sessionId: string, chunk: string): Promise<void> {
    await this.logStore.append(sessionId, chunk);
    this.scheduleSessionTimeout(sessionId);
    await this.sessionService.touchOutput(sessionId);
    await this.eventStore.append({
      session_id: sessionId,
      event_type: "terminal_output",
      summary: "Terminal output received",
      metadata: { bytes: chunk.length }
    });
    await this.taskService.handleTerminalOutput(sessionId, chunk);
    this.broadcast(sessionId, {
      type: "output",
      sessionId,
      data: chunk
    });
    this.broadcastStatus(sessionId);
  }

  private async handleExit(sessionId: string, exitCode: number, signal?: number): Promise<void> {
    this.ptySessions.delete(sessionId);
    this.clearSessionTimeout(sessionId);
    const wasClosing = this.closingSessions.delete(sessionId);
    const terminalStatus = wasClosing || exitCode === 0 ? "CLOSED" : "ERROR";
    await this.sessionService.updateTerminalStatus(sessionId, terminalStatus);
    await this.eventStore.append({
      session_id: sessionId,
      event_type: "session_closed",
      summary: `Codex PTY exited with code ${exitCode}`,
      metadata: { exitCode, signal }
    });
    this.broadcastStatus(sessionId);
  }

  private broadcast(sessionId: string, payload: unknown): void {
    const encoded = JSON.stringify(payload);
    for (const client of this.clients.get(sessionId) ?? []) {
      client.send(encoded);
    }
  }

  private scheduleSessionTimeout(sessionId: string): void {
    this.clearSessionTimeout(sessionId);
    const timeoutMs = this.config.codex.taskTimeoutMinutes * 60 * 1000;
    if (timeoutMs <= 0) {
      return;
    }
    const timer = setTimeout(() => {
      void this.handleSessionTimeout(sessionId);
    }, timeoutMs);
    this.sessionTimers.set(sessionId, timer);
  }

  private clearSessionTimeout(sessionId: string): void {
    const timer = this.sessionTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.sessionTimers.delete(sessionId);
    }
  }

  private async handleSessionTimeout(sessionId: string): Promise<void> {
    if (!this.ptySessions.has(sessionId)) {
      return;
    }
    await this.eventStore.append({
      session_id: sessionId,
      event_type: "session_closed",
      summary: `Session timed out after ${this.config.codex.taskTimeoutMinutes} minutes`,
      metadata: { timeoutMinutes: this.config.codex.taskTimeoutMinutes }
    });
    await this.taskService.cancelActiveTaskForSession(sessionId);
    await this.closeSession(sessionId);
  }
}
