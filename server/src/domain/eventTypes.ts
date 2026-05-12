export type EventType =
  | "session_created"
  | "session_started"
  | "session_connected"
  | "session_disconnected"
  | "session_closed"
  | "session_archived"
  | "session_deleted"
  | "terminal_output"
  | "terminal_input"
  | "task_created"
  | "task_started"
  | "status_changed"
  | "user_input_requested"
  | "user_input_submitted"
  | "task_completed"
  | "task_failed"
  | "task_cancelled"
  | "git_status_refreshed"
  | "git_diff_viewed";

export interface RemoteCodexEvent {
  id: string;
  session_id: string;
  task_id?: string;
  event_type: EventType;
  event_time: string;
  summary: string;
  metadata: Record<string, unknown>;
}
