import type { ChatActivity, ChatMessage, ChatMessageStatus } from "../domain/chatTypes";

type JsonRecord = Record<string, unknown>;

export function projectCodexThreadToMessages(sessionId: string, threadInput: unknown): ChatMessage[] {
  const thread = asRecord(threadInput);
  const threadId = readString(thread, "id") ?? "unknown-thread";
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const messages: ChatMessage[] = [];

  turns.forEach((turnInput, turnIndex) => {
    const turn = asRecord(turnInput);
    if (!turn) {
      return;
    }
    const turnId = readString(turn, "id") ?? `turn-${turnIndex}`;
    const items = Array.isArray(turn.items) ? turn.items.map(asRecord).filter((item): item is JsonRecord => Boolean(item)) : [];
    const startedAt = readNumber(turn, "startedAt");
    const completedAt = readNumber(turn, "completedAt");
    const durationMs = readNumber(turn, "durationMs");
    const turnStatus = readString(turn, "status");
    const baseDate = isoFromUnixSeconds(startedAt, turnIndex * 2000);

    const userItems = items.filter((item) => readString(item, "type") === "userMessage");
    userItems.forEach((item, itemIndex) => {
      messages.push({
        id: stableMessageId(threadId, turnId, readString(item, "id") ?? `user-${itemIndex}`, "user"),
        session_id: sessionId,
        role: "user",
        content: formatUserMessageContent(item),
        status: "complete",
        attachments: [],
        activities: [],
        duration_ms: null,
        started_at: null,
        completed_at: null,
        turn_id: turnId,
        created_at: isoWithOffset(baseDate, itemIndex),
        updated_at: isoWithOffset(baseDate, itemIndex),
        error: null
      });
    });

    const assistant = projectAssistantMessage(sessionId, threadId, turnId, items, {
      status: turnStatus,
      startedAt,
      completedAt,
      durationMs,
      baseDate,
      turnError: turn.error
    });
    if (assistant) {
      messages.push(assistant);
    }
  });

  return messages.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function projectAssistantMessage(
  sessionId: string,
  threadId: string,
  turnId: string,
  items: JsonRecord[],
  turn: {
    status: string | null;
    startedAt: number | null;
    completedAt: number | null;
    durationMs: number | null;
    baseDate: string;
    turnError: unknown;
  }
): ChatMessage | null {
  const contentParts: string[] = [];
  const activities: ChatActivity[] = [];
  let assistantItemId: string | null = null;

  items.forEach((item, itemIndex) => {
    const type = readString(item, "type");
    const itemId = readString(item, "id") ?? `${type ?? "item"}-${itemIndex}`;
    if (type === "userMessage" || type === "hookPrompt") {
      return;
    }
    if (type === "agentMessage") {
      const text = readString(item, "text") ?? "";
      const phase = readString(item, "phase");
      assistantItemId ??= itemId;
      if (phase === "commentary") {
        activities.push(createActivity(threadId, turnId, itemId, "Thinking", text, turn, itemIndex));
      } else if (text) {
        contentParts.push(text);
      }
      return;
    }
    if (type === "plan") {
      activities.push(createActivity(threadId, turnId, itemId, "Plan", readString(item, "text") ?? "", turn, itemIndex));
      return;
    }
    if (type === "reasoning") {
      const content = [...readStringArray(item.summary), ...readStringArray(item.content)].join("\n\n");
      activities.push(createActivity(threadId, turnId, itemId, "Thinking", content, turn, itemIndex));
      return;
    }
    if (type === "commandExecution") {
      activities.push(createActivity(threadId, turnId, itemId, "Command", formatCommandExecution(item), turn, itemIndex));
      return;
    }
    if (type === "fileChange") {
      activities.push(createActivity(threadId, turnId, itemId, "File changes", formatFileChange(item), turn, itemIndex));
      return;
    }
    if (type === "mcpToolCall") {
      activities.push(createActivity(threadId, turnId, itemId, "MCP tool", formatToolCall(item), turn, itemIndex));
      return;
    }
    if (type === "dynamicToolCall") {
      activities.push(createActivity(threadId, turnId, itemId, "Tool call", formatToolCall(item), turn, itemIndex));
      return;
    }
    if (type === "webSearch") {
      activities.push(createActivity(threadId, turnId, itemId, "Web search", readString(item, "query") ?? "", turn, itemIndex));
    }
  });

  const content = contentParts.join("\n\n").trim();
  const status = toChatMessageStatus(turn.status);
  const error = status === "error" ? formatTurnError(turn.turnError) : null;
  if (!content && activities.length === 0 && status === "complete") {
    return null;
  }

  const createdAt = isoWithOffset(turn.baseDate, 1000);
  return {
    id: stableMessageId(threadId, turnId, assistantItemId ?? "assistant", "assistant"),
    session_id: sessionId,
    role: "assistant",
    content,
    status,
    attachments: [],
    activities,
    duration_ms: turn.durationMs,
    started_at: turn.startedAt === null ? null : isoFromUnixSeconds(turn.startedAt, 0),
    completed_at: turn.completedAt === null ? null : isoFromUnixSeconds(turn.completedAt, 0),
    turn_id: turnId,
    created_at: createdAt,
    updated_at: turn.completedAt === null ? createdAt : isoFromUnixSeconds(turn.completedAt, 0),
    error
  };
}

function createActivity(
  threadId: string,
  turnId: string,
  itemId: string,
  title: string,
  content: string,
  turn: { status: string | null; baseDate: string; completedAt: number | null },
  index: number
): ChatActivity {
  const startedAt = isoWithOffset(turn.baseDate, 100 + index);
  return {
    id: `codex:${threadId}:${turnId}:${itemId}:activity`,
    item_id: itemId,
    kind: "thinking",
    title,
    content,
    status: turn.status === "inProgress" ? "streaming" : "complete",
    started_at: startedAt,
    completed_at: turn.completedAt === null ? null : isoFromUnixSeconds(turn.completedAt, 0)
  };
}

function formatUserMessageContent(item: JsonRecord): string {
  const content = Array.isArray(item.content) ? item.content : [];
  const parts = content.map((entry) => {
    const record = asRecord(entry);
    const type = readString(record, "type");
    if (type === "text") {
      return readString(record, "text") ?? "";
    }
    if (type === "image" || type === "localImage") {
      return "[Image attached]";
    }
    if (type === "skill") {
      return `[Skill: ${readString(record, "name") ?? "unnamed"}]`;
    }
    if (type === "mention") {
      return `[Mention: ${readString(record, "name") ?? "unnamed"}]`;
    }
    return "";
  });
  return parts.filter(Boolean).join("\n\n").trim();
}

function formatCommandExecution(item: JsonRecord): string {
  const lines = [`$ ${readString(item, "command") ?? ""}`.trim()];
  const output = readString(item, "aggregatedOutput");
  const exitCode = readNumber(item, "exitCode");
  if (output) {
    lines.push("", output);
  }
  if (exitCode !== null) {
    lines.push("", `Exit code: ${exitCode}`);
  }
  return lines.filter((line, index) => index === 0 || line !== "").join("\n");
}

function formatFileChange(item: JsonRecord): string {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  if (changes.length === 0) {
    return readString(item, "path") ?? readString(item, "file") ?? "File changes recorded.";
  }
  return changes
    .map((change) => {
      const record = asRecord(change);
      const path = readString(record, "path") ?? readString(record, "file") ?? "Changed file";
      const additions = readNumber(record, "additions") ?? readNumber(record, "added");
      const deletions = readNumber(record, "deletions") ?? readNumber(record, "deleted");
      const stats = additions !== null || deletions !== null ? ` +${additions ?? 0} -${deletions ?? 0}` : "";
      return `${path}${stats}`;
    })
    .join("\n");
}

function formatToolCall(item: JsonRecord): string {
  const server = readString(item, "server");
  const namespace = readString(item, "namespace");
  const tool = readString(item, "tool") ?? "tool";
  const status = readString(item, "status");
  return [server ?? namespace, tool, status].filter(Boolean).join(" / ");
}

function formatTurnError(errorInput: unknown): string | null {
  const error = asRecord(errorInput);
  if (!error) {
    return "Codex turn failed.";
  }
  return readString(error, "message") ?? readString(error, "type") ?? "Codex turn failed.";
}

function stableMessageId(threadId: string, turnId: string, itemId: string, role: "user" | "assistant"): string {
  return `codex:${threadId}:${turnId}:${itemId}:${role}`;
}

function toChatMessageStatus(status: string | null): ChatMessageStatus {
  if (status === "inProgress") {
    return "streaming";
  }
  if (status === "failed" || status === "interrupted") {
    return "error";
  }
  return "complete";
}

function isoFromUnixSeconds(value: number | null, fallbackOffsetMs: number): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  return new Date(Date.now() + fallbackOffsetMs).toISOString();
}

function isoWithOffset(iso: string, offsetMs: number): string {
  return new Date(Date.parse(iso) + offsetMs).toISOString();
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function readString(record: JsonRecord | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function readNumber(record: JsonRecord | null | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}
