import path from "node:path";
import type {
  ChatActivity,
  ChatActivityKind,
  ChatActivityStatus,
  ChatMessage,
  ChatMessageRole,
  ChatMessageStatus
} from "../domain/chatTypes";
import type { PublicAttachmentMetadata } from "../domain/attachmentTypes";
import { deleteFileIfExists, ensureDir, readJsonFile, writeJsonFile } from "../utils/fileStore";
import { createId, nowIso } from "../utils/ids";
import { validateSessionId } from "../utils/validation";

export class ChatMessageStore {
  private readonly messagesDir: string;
  private readonly messages = new Map<string, ChatMessage[]>();

  constructor(dataRoot: string) {
    this.messagesDir = path.join(dataRoot, "messages");
  }

  async init(): Promise<void> {
    await ensureDir(this.messagesDir);
  }

  async list(sessionId: string): Promise<ChatMessage[]> {
    validateSessionId(sessionId);
    if (!this.messages.has(sessionId)) {
      const stored = await readJsonFile<ChatMessage[]>(this.messagePath(sessionId));
      this.messages.set(sessionId, (stored ?? []).map(normalizeMessage));
    }
    return [...(this.messages.get(sessionId) ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async create(input: {
    sessionId: string;
    role: ChatMessageRole;
    content: string;
    status: ChatMessageStatus;
    turnId?: string | null;
    attachments?: PublicAttachmentMetadata[];
  }): Promise<ChatMessage> {
    validateSessionId(input.sessionId);
    const now = nowIso();
    const message: ChatMessage = {
      id: createId(),
      session_id: input.sessionId,
      role: input.role,
      content: input.content,
      status: input.status,
      attachments: input.attachments ?? [],
      activities: [],
      duration_ms: null,
      started_at: null,
      completed_at: null,
      turn_id: input.turnId ?? null,
      created_at: now,
      updated_at: now,
      error: null
    };
    const messages = await this.list(input.sessionId);
    messages.push(message);
    await this.saveSession(input.sessionId, messages);
    return message;
  }

  async replaceSession(sessionId: string, messages: ChatMessage[]): Promise<void> {
    validateSessionId(sessionId);
    const normalized = messages.map(normalizeMessage).sort((a, b) => a.created_at.localeCompare(b.created_at));
    this.messages.set(sessionId, normalized);
    await this.saveSession(sessionId, normalized);
  }

  async appendContent(sessionId: string, messageId: string, delta: string): Promise<ChatMessage | null> {
    if (!delta) {
      return null;
    }
    const message = await this.update(sessionId, messageId, (current) => {
      current.content += delta;
    });
    return message;
  }

  async setContent(sessionId: string, messageId: string, content: string): Promise<ChatMessage | null> {
    return this.update(sessionId, messageId, (current) => {
      current.content = content;
    });
  }

  async setTurnStarted(sessionId: string, messageId: string, startedAt: string = nowIso()): Promise<ChatMessage | null> {
    return this.update(sessionId, messageId, (current) => {
      current.started_at = startedAt;
    });
  }

  async setTurnCompleted(
    sessionId: string,
    messageId: string,
    input: { completedAt?: string | null; durationMs?: number | null }
  ): Promise<ChatMessage | null> {
    return this.update(sessionId, messageId, (current) => {
      const completedAt = input.completedAt ?? nowIso();
      current.completed_at = completedAt;
      current.duration_ms =
        typeof input.durationMs === "number"
          ? input.durationMs
          : current.started_at
            ? Math.max(0, Date.parse(completedAt) - Date.parse(current.started_at))
            : null;
    });
  }

  async upsertActivity(
    sessionId: string,
    messageId: string,
    input: {
      itemId: string | null;
      kind: ChatActivityKind;
      title: string;
      content: string;
      status: ChatActivityStatus;
      startedAt?: string | null;
    }
  ): Promise<ChatActivity | null> {
    let activity: ChatActivity | null = null;
    await this.update(sessionId, messageId, (current) => {
      const existing = input.itemId ? current.activities.find((item) => item.item_id === input.itemId) : null;
      if (existing) {
        existing.title = input.title;
        existing.kind = input.kind;
        existing.content = input.content || existing.content;
        existing.status = input.status;
        activity = existing;
        return;
      }
      activity = {
        id: createId(),
        item_id: input.itemId,
        kind: input.kind,
        title: input.title,
        content: input.content,
        status: input.status,
        started_at: input.startedAt ?? nowIso(),
        completed_at: null
      };
      current.activities.push(activity);
    });
    return activity;
  }

  async appendActivityContent(
    sessionId: string,
    messageId: string,
    activityId: string,
    delta: string
  ): Promise<ChatActivity | null> {
    if (!delta) {
      return null;
    }
    return this.updateActivity(sessionId, messageId, activityId, (activity) => {
      activity.content += delta;
      activity.status = "streaming";
    });
  }

  async setActivityContent(
    sessionId: string,
    messageId: string,
    activityId: string,
    content: string
  ): Promise<ChatActivity | null> {
    return this.updateActivity(sessionId, messageId, activityId, (activity) => {
      activity.content = content;
    });
  }

  async completeActivity(
    sessionId: string,
    messageId: string,
    activityId: string,
    completedAt: string | null = null
  ): Promise<ChatActivity | null> {
    return this.updateActivity(sessionId, messageId, activityId, (activity) => {
      activity.status = "complete";
      activity.completed_at = completedAt ?? nowIso();
    });
  }

  async setStatus(
    sessionId: string,
    messageId: string,
    status: ChatMessageStatus,
    error: string | null = null
  ): Promise<ChatMessage | null> {
    return this.update(sessionId, messageId, (current) => {
      current.status = status;
      current.error = error;
    });
  }

  async deleteForSession(sessionId: string): Promise<void> {
    validateSessionId(sessionId);
    this.messages.delete(sessionId);
    await deleteFileIfExists(this.messagePath(sessionId));
  }

  private async update(
    sessionId: string,
    messageId: string,
    mutate: (message: ChatMessage) => void
  ): Promise<ChatMessage | null> {
    const messages = await this.list(sessionId);
    const message = messages.find((item) => item.id === messageId);
    if (!message) {
      return null;
    }
    mutate(message);
    message.updated_at = nowIso();
    await this.saveSession(sessionId, messages);
    return message;
  }

  private async updateActivity(
    sessionId: string,
    messageId: string,
    activityId: string,
    mutate: (activity: ChatActivity) => void
  ): Promise<ChatActivity | null> {
    let updated: ChatActivity | null = null;
    await this.update(sessionId, messageId, (message) => {
      const activity = message.activities.find((item) => item.id === activityId);
      if (!activity) {
        return;
      }
      mutate(activity);
      updated = activity;
    });
    return updated;
  }

  private async saveSession(sessionId: string, messages: ChatMessage[]): Promise<void> {
    this.messages.set(sessionId, messages);
    await writeJsonFile(this.messagePath(sessionId), messages);
  }

  private messagePath(sessionId: string): string {
    return path.join(this.messagesDir, `${sessionId}.json`);
  }
}

function normalizeMessage(message: ChatMessage): ChatMessage {
  const partial = message as ChatMessage &
    Partial<Pick<ChatMessage, "attachments" | "activities" | "duration_ms" | "started_at" | "completed_at">>;
  return {
    ...message,
    attachments: Array.isArray(partial.attachments) ? partial.attachments.map(normalizeAttachment).filter(isAttachment) : [],
    activities: Array.isArray(partial.activities) ? partial.activities.map(normalizeActivity) : [],
    duration_ms: typeof partial.duration_ms === "number" ? partial.duration_ms : null,
    started_at: typeof partial.started_at === "string" ? partial.started_at : null,
    completed_at: typeof partial.completed_at === "string" ? partial.completed_at : null
  };
}

function normalizeAttachment(attachment: PublicAttachmentMetadata): PublicAttachmentMetadata | null {
  const partial = attachment as Partial<PublicAttachmentMetadata>;
  if (
    typeof partial.id !== "string" ||
    typeof partial.session_id !== "string" ||
    typeof partial.original_name !== "string" ||
    typeof partial.stored_name !== "string" ||
    typeof partial.mime_type !== "string" ||
    typeof partial.size_bytes !== "number" ||
    typeof partial.created_at !== "string"
  ) {
    return null;
  }
  return {
    id: partial.id,
    session_id: partial.session_id,
    original_name: partial.original_name,
    stored_name: partial.stored_name,
    mime_type: partial.mime_type,
    size_bytes: partial.size_bytes,
    kind: partial.kind === "image" || partial.kind === "video" || partial.kind === "file" ? partial.kind : "file",
    created_at: partial.created_at
  };
}

function isAttachment(value: PublicAttachmentMetadata | null): value is PublicAttachmentMetadata {
  return value !== null;
}

function normalizeActivity(activity: ChatActivity): ChatActivity {
  const partial = activity as ChatActivity & Partial<ChatActivity>;
  return {
    id: typeof partial.id === "string" ? partial.id : createId(),
    item_id: typeof partial.item_id === "string" ? partial.item_id : null,
    kind: partial.kind === "thinking" ? partial.kind : "thinking",
    title: typeof partial.title === "string" && partial.title ? partial.title : "Thinking",
    content: typeof partial.content === "string" ? partial.content : "",
    status: partial.status === "complete" ? "complete" : "streaming",
    started_at: typeof partial.started_at === "string" ? partial.started_at : nowIso(),
    completed_at: typeof partial.completed_at === "string" ? partial.completed_at : null
  };
}
