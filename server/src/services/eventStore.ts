import path from "node:path";
import type { RemoteCodexEvent, EventType } from "../domain/eventTypes";
import { appendJsonLine, deleteFileIfExists, ensureDir, pathExists } from "../utils/fileStore";
import { createId, nowIso } from "../utils/ids";
import fs from "node:fs/promises";

export class EventStore {
  private readonly eventsDir: string;

  constructor(dataRoot: string) {
    this.eventsDir = path.join(dataRoot, "events");
  }

  async init(): Promise<void> {
    await ensureDir(this.eventsDir);
  }

  async append(input: {
    session_id: string;
    task_id?: string;
    event_type: EventType;
    summary: string;
    metadata?: Record<string, unknown>;
  }): Promise<RemoteCodexEvent> {
    const event: RemoteCodexEvent = {
      id: createId(),
      session_id: input.session_id,
      task_id: input.task_id,
      event_type: input.event_type,
      event_time: nowIso(),
      summary: input.summary,
      metadata: input.metadata ?? {}
    };
    await appendJsonLine(this.eventPath(input.session_id), event);
    return event;
  }

  async listSessionEvents(sessionId: string): Promise<RemoteCodexEvent[]> {
    const filePath = this.eventPath(sessionId);
    if (!(await pathExists(filePath))) {
      return [];
    }
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RemoteCodexEvent);
  }

  async listTaskEvents(sessionId: string, taskId: string): Promise<RemoteCodexEvent[]> {
    const events = await this.listSessionEvents(sessionId);
    return events.filter((event) => event.task_id === taskId);
  }

  async deleteSessionEvents(sessionId: string): Promise<void> {
    await deleteFileIfExists(this.eventPath(sessionId));
  }

  private eventPath(sessionId: string): string {
    return path.join(this.eventsDir, `${sessionId}.jsonl`);
  }
}
