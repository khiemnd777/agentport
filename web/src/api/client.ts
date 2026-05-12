export type SessionSource = "iphone_web" | "desktop_web" | "local_cli" | "automation";
export type ControlMode = "web_managed" | "local_terminal" | "non_interactive";
export type TerminalStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "RUNNING" | "CLOSED" | "ERROR";
export type TaskStatus = "IDLE" | "CREATED" | "RUNNING" | "WAITING_FOR_USER" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface PublicRepo {
  key: string;
  label: string;
}

export interface PublicCodexModel {
  id: string;
  label: string;
}

export type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface PublicCodexReasoningEffort {
  id: CodexReasoningEffort;
  label: string;
}

export type CodexPermissionMode = "default" | "auto-review" | "full-access";

export interface PublicCodexPermissionMode {
  id: CodexPermissionMode;
  label: string;
  description: string;
  highRisk: boolean;
}

export interface CodexSession {
  id: string;
  repo_key: string;
  branch_name: string | null;
  title: string;
  source: SessionSource;
  control_mode: ControlMode;
  terminal_status: TerminalStatus;
  task_status: TaskStatus;
  active_task_id: string | null;
  codex_thread_id: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  closed_at: string | null;
  last_output_at: string | null;
  archived_at: string | null;
}

export type ChatMessageRole = "user" | "assistant" | "system";
export type ChatMessageStatus = "complete" | "streaming" | "error";
export type ChatActivityKind = "thinking";
export type ChatActivityStatus = "streaming" | "complete";

export interface ChatActivity {
  id: string;
  item_id: string | null;
  kind: ChatActivityKind;
  title: string;
  content: string;
  status: ChatActivityStatus;
  started_at: string;
  completed_at: string | null;
}

export interface ChatAttachment {
  id: string;
  session_id?: string;
  original_name: string;
  stored_name?: string;
  mime_type: string;
  size_bytes: number;
  kind: "image" | "video" | "file";
  created_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  activities: ChatActivity[];
  attachments: ChatAttachment[];
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  turn_id: string | null;
  created_at: string;
  updated_at: string;
  error: string | null;
}

export type ChatSocketEvent =
  | { type: "connected"; sessionId: string }
  | { type: "message_created"; sessionId: string; message: ChatMessage }
  | { type: "message_delta"; sessionId: string; messageId: string; delta: string }
  | { type: "message_updated"; sessionId: string; message: ChatMessage }
  | { type: "session_status"; sessionId: string; session: CodexSession }
  | { type: "error"; sessionId: string; code: string; message: string };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface Task {
  id: string;
  session_id: string;
  repo_key: string;
  title: string;
  prompt: string;
  source: SessionSource;
  control_mode: ControlMode;
  status: TaskStatus;
  user_input_channel: "web_ui" | "local_terminal" | "automation";
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
}

export interface RemoteCodexEvent {
  id: string;
  session_id: string;
  task_id?: string;
  event_type: string;
  event_time: string;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface GitChangedFile {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  originalPath?: string;
  additions?: number;
  deletions?: number;
}

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitChangedFile[];
  raw: string;
  isRepository: boolean;
  error?: string;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const usesFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (!headers.has("Content-Type") && !usesFormData) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data.error || `Request failed with ${response.status}`;
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("agent-port-auth-expired"));
    }
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export function terminalSocketUrl(sessionId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/sessions/${sessionId}/terminal`;
}

export function chatSocketUrl(sessionId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/sessions/${sessionId}/chat`;
}
