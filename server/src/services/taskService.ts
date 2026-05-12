import path from "node:path";
import type { AppConfig } from "../config";
import type { CodexSession } from "../domain/sessionTypes";
import type { PublicTask, Task, TaskStatus } from "../domain/taskTypes";
import { canEnterWaitingForUser, isTerminalTaskStatus, validateStatusTransition } from "../domain/statusRules";
import { deleteFileIfExists, ensureDir, listJsonFiles, writeJsonFile } from "../utils/fileStore";
import { createId, nowIso } from "../utils/ids";
import { badRequest, conflict, notFound } from "../utils/httpErrors";
import { validateTaskId } from "../utils/validation";
import { wrapPromptForRemoteCodex } from "./codexPromptWrapper";
import type { EventStore } from "./eventStore";
import type { SessionService } from "./sessionService";

const ansiPattern = /\x1B\[[0-?]*[ -/]*[@-~]/g;

export interface TaskNotificationSink {
  notifyTaskTransition(task: Task, status: TaskStatus): Promise<void>;
}

export class TaskService {
  private readonly tasks = new Map<string, Task>();
  private readonly tasksDir: string;
  private readonly outputBuffers = new Map<string, string>();
  private readonly taskTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    dataRoot: string,
    private readonly config: AppConfig,
    private readonly sessionService: SessionService,
    private readonly eventStore: EventStore,
    private readonly notificationSink?: TaskNotificationSink
  ) {
    this.tasksDir = path.join(dataRoot, "tasks");
  }

  async init(): Promise<void> {
    await ensureDir(this.tasksDir);
    const tasks = await listJsonFiles<Task>(this.tasksDir);
    for (const task of tasks) {
      this.tasks.set(task.id, task);
    }
  }

  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  listPublic(): PublicTask[] {
    return this.list().map(toPublicTask);
  }

  get(id: string): Task {
    validateTaskId(id);
    const task = this.tasks.get(id);
    if (!task) {
      throw notFound("Task not found");
    }
    return task;
  }

  getPublic(id: string): PublicTask {
    return toPublicTask(this.get(id));
  }

  async createAndStart(session: CodexSession, input: { title?: string; prompt: string }): Promise<Task> {
    const activeTasks = this.list().filter((task) => this.isCurrentlyActiveTask(task));
    if (activeTasks.length >= this.config.limits.maxActiveTasks) {
      throw conflict("Maximum active tasks reached");
    }

    const prompt = input.prompt.trim();
    if (!prompt) {
      throw badRequest("Task prompt is required");
    }

    const now = nowIso();
    const task: Task = {
      id: createId(),
      session_id: session.id,
      repo_key: session.repo_key,
      title: input.title?.trim() || prompt.slice(0, 80),
      prompt,
      wrapped_prompt: wrapPromptForRemoteCodex(prompt),
      source: session.source,
      control_mode: session.control_mode,
      status: "CREATED",
      user_input_channel: session.control_mode === "web_managed" ? "web_ui" : "local_terminal",
      created_at: now,
      updated_at: now,
      started_at: null,
      finished_at: null,
      last_error: null
    };
    this.tasks.set(task.id, task);
    await this.save(task);
    await this.eventStore.append({
      session_id: session.id,
      task_id: task.id,
      event_type: "task_created",
      summary: `Task created: ${task.title}`,
      metadata: { title: task.title }
    });
    await this.transition(task, "RUNNING", "Task started");
    await this.sessionService.setTaskState(session.id, "RUNNING", task.id);
    return task;
  }

  async submitInput(taskId: string, text: string): Promise<Task> {
    const task = this.get(taskId);
    if (task.control_mode !== "web_managed") {
      throw conflict("This session is controlled from the local terminal. Remote input is disabled.");
    }
    if (isTerminalTaskStatus(task.status)) {
      throw conflict("Task is already finished");
    }
    await this.eventStore.append({
      session_id: task.session_id,
      task_id: task.id,
      event_type: "user_input_submitted",
      summary: "User submitted follow-up input",
      metadata: { bytes: text.length }
    });
    if (task.status === "WAITING_FOR_USER") {
      await this.transition(task, "RUNNING", "Task resumed after user input");
      await this.sessionService.setTaskState(task.session_id, "RUNNING", task.id);
    }
    this.outputBuffers.delete(task.session_id);
    return task;
  }

  async cancel(taskId: string): Promise<Task> {
    const task = this.get(taskId);
    if (isTerminalTaskStatus(task.status)) {
      return task;
    }
    await this.transition(task, "CANCELLED", "Task cancelled");
    await this.eventStore.append({
      session_id: task.session_id,
      task_id: task.id,
      event_type: "task_cancelled",
      summary: "Task cancelled",
      metadata: {}
    });
    await this.sessionService.setTaskState(task.session_id, "CANCELLED", null);
    return task;
  }

  async cancelActiveTaskForSession(sessionId: string): Promise<void> {
    const session = this.sessionService.get(sessionId);
    if (!session.active_task_id) {
      return;
    }
    await this.cancel(session.active_task_id);
  }

  async deleteForSession(sessionId: string): Promise<void> {
    const tasks = this.list().filter((task) => task.session_id === sessionId);
    for (const task of tasks) {
      this.clearTaskTimeout(task.id);
      this.tasks.delete(task.id);
      this.outputBuffers.delete(sessionId);
      await deleteFileIfExists(path.join(this.tasksDir, `${task.id}.json`));
    }
  }

  async failTask(taskId: string, reason: string): Promise<Task> {
    const task = this.get(taskId);
    if (isTerminalTaskStatus(task.status)) {
      return task;
    }
    task.last_error = reason;
    await this.transition(task, "FAILED", reason);
    await this.eventStore.append({
      session_id: task.session_id,
      task_id: task.id,
      event_type: "task_failed",
      summary: reason,
      metadata: {}
    });
    await this.sessionService.setTaskState(task.session_id, "FAILED", null);
    return task;
  }

  async handleTerminalOutput(sessionId: string, chunk: string): Promise<void> {
    const session = this.sessionService.get(sessionId);
    if (!session.active_task_id) {
      return;
    }
    const task = this.get(session.active_task_id);
    if (isTerminalTaskStatus(task.status)) {
      return;
    }

    const cleanChunk = chunk.replace(ansiPattern, "");
    const buffer = ((this.outputBuffers.get(sessionId) ?? "") + cleanChunk).slice(-4000);
    this.outputBuffers.set(sessionId, buffer);

    const userInput = extractMarkerPayload(buffer, "[USER_INPUT_REQUIRED]");
    if (userInput && task.status === "RUNNING") {
      await this.eventStore.append({
        session_id: session.id,
        task_id: task.id,
        event_type: "user_input_requested",
        summary: userInput,
        metadata: { question: userInput }
      });
      if (canEnterWaitingForUser(task)) {
        await this.transition(task, "WAITING_FOR_USER", "Codex requested user input");
        await this.sessionService.setTaskState(session.id, "WAITING_FOR_USER", task.id);
      }
      this.outputBuffers.delete(sessionId);
      return;
    }

    const blocked = extractMarkerPayload(buffer, "[TASK_BLOCKED]");
    if (blocked) {
      task.last_error = blocked;
      await this.transition(task, "FAILED", blocked);
      await this.eventStore.append({
        session_id: session.id,
        task_id: task.id,
        event_type: "task_failed",
        summary: blocked,
        metadata: { reason: blocked }
      });
      await this.sessionService.setTaskState(session.id, "FAILED", null);
      this.outputBuffers.delete(sessionId);
      return;
    }

    if (buffer.includes("[TASK_COMPLETED]")) {
      await this.transition(task, "COMPLETED", "Task completed");
      await this.eventStore.append({
        session_id: session.id,
        task_id: task.id,
        event_type: "task_completed",
        summary: "Task completed",
        metadata: {}
      });
      await this.sessionService.setTaskState(session.id, "COMPLETED", null);
      this.outputBuffers.delete(sessionId);
    }
  }

  private async transition(task: Task, to: TaskStatus, summary: string): Promise<void> {
    const from = task.status;
    validateStatusTransition(from, to, task.control_mode);
    const now = nowIso();
    task.status = to;
    task.updated_at = now;
    if (to === "RUNNING" && !task.started_at) {
      task.started_at = now;
    }
    if (isTerminalTaskStatus(to) && !task.finished_at) {
      task.finished_at = now;
    }
    await this.save(task);
    if (to === "RUNNING") {
      this.scheduleTaskTimeout(task.id);
    }
    if (to === "WAITING_FOR_USER" || isTerminalTaskStatus(to)) {
      this.clearTaskTimeout(task.id);
    }
    await this.eventStore.append({
      session_id: task.session_id,
      task_id: task.id,
      event_type: "status_changed",
      summary,
      metadata: { from, to }
    });
    if (to === "WAITING_FOR_USER" || isTerminalTaskStatus(to)) {
      void this.notificationSink?.notifyTaskTransition(task, to).catch((error) => {
        console.error("Task notification failed", error);
      });
    }
  }

  private async save(task: Task): Promise<void> {
    await writeJsonFile(path.join(this.tasksDir, `${task.id}.json`), task);
  }

  private isCurrentlyActiveTask(task: Task): boolean {
    if (!["CREATED", "RUNNING", "WAITING_FOR_USER"].includes(task.status)) {
      return false;
    }
    try {
      const session = this.sessionService.get(task.session_id);
      return (
        session.active_task_id === task.id &&
        ["CONNECTING", "CONNECTED", "RUNNING"].includes(session.terminal_status)
      );
    } catch {
      return false;
    }
  }

  private scheduleTaskTimeout(taskId: string): void {
    this.clearTaskTimeout(taskId);
    const timeoutMs = this.config.codex.taskTimeoutMinutes * 60 * 1000;
    if (timeoutMs <= 0) {
      return;
    }
    const timer = setTimeout(() => {
      const task = this.tasks.get(taskId);
      if (!task || task.status !== "RUNNING") {
        return;
      }
      void this.failTask(taskId, `Task timed out after ${this.config.codex.taskTimeoutMinutes} minutes`);
    }, timeoutMs);
    this.taskTimers.set(taskId, timer);
  }

  private clearTaskTimeout(taskId: string): void {
    const timer = this.taskTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.taskTimers.delete(taskId);
    }
  }
}

export function toPublicTask(task: Task): PublicTask {
  const { wrapped_prompt: _wrappedPrompt, ...publicTask } = task;
  return publicTask;
}

function extractMarkerPayload(buffer: string, marker: string): string | null {
  const index = buffer.indexOf(marker);
  if (index === -1) {
    return null;
  }
  const after = buffer.slice(index + marker.length);
  const line = after.split(/\r?\n/)[0]?.trim();
  return line || marker;
}
