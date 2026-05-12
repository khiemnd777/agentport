type JsonRecord = Record<string, unknown>;

export function extractThreadIdFromCodexEvent(event: unknown): string | null {
  const record = asRecord(event);
  if (!record) {
    return null;
  }
  return (
    readString(record, "threadId") ??
    readString(record, "thread_id") ??
    readString(record, "sessionId") ??
    readString(record, "session_id") ??
    readString(asRecord(record.params) ?? {}, "threadId") ??
    readString(asRecord(record.params) ?? {}, "thread_id") ??
    readString(asRecord(record.params) ?? {}, "sessionId") ??
    readString(asRecord(record.params) ?? {}, "session_id") ??
    extractThreadIdFromNested(record)
  );
}

export function extractAgentDeltaFromCodexEvent(event: unknown): string | null {
  const record = asRecord(event);
  if (!record) {
    return null;
  }
  const method = readString(record, "method") ?? readString(record, "type") ?? "";
  const params = asRecord(record.params);
  if (method.includes("agentMessage") && params) {
    return readString(params, "delta");
  }
  if (method.includes("agent_message") || method.includes("message_delta")) {
    return readString(record, "delta") ?? (params ? readString(params, "delta") : null);
  }
  return null;
}

export function extractFinalAgentTextFromCodexEvent(event: unknown): string | null {
  const record = asRecord(event);
  if (!record) {
    return null;
  }
  const params = asRecord(record.params);
  const item = asRecord(params?.item) ?? asRecord(record.item);
  const itemText = extractTextFromAssistantItem(item);
  if (itemText) {
    return itemText;
  }
  return extractTextFromAssistantItem(record);
}

function extractThreadIdFromNested(record: JsonRecord): string | null {
  const thread = asRecord(record.thread) ?? asRecord(asRecord(record.params)?.thread);
  if (thread) {
    return readString(thread, "id") ?? readString(thread, "threadId") ?? readString(thread, "sessionId");
  }
  const turn = asRecord(record.turn) ?? asRecord(asRecord(record.params)?.turn);
  if (turn) {
    return readString(turn, "threadId") ?? readString(turn, "thread_id");
  }
  return null;
}

function extractTextFromAssistantItem(item: JsonRecord | null): string | null {
  if (!item) {
    return null;
  }
  const itemType = readString(item, "type");
  const role = readString(item, "role");
  if (itemType === "agentMessage" || itemType === "agent_message") {
    return readString(item, "text");
  }
  if (role === "assistant") {
    const text = readString(item, "text");
    if (text) {
      return text;
    }
    const content = item.content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      const parts = content
        .map((part) => {
          const contentPart = asRecord(part);
          return contentPart ? readString(contentPart, "text") : null;
        })
        .filter((part): part is string => Boolean(part));
      return parts.length ? parts.join("") : null;
    }
  }
  return null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function readString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value ? value : null;
}
