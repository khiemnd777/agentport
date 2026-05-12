import type { ControlMode, SessionSource } from "./sessionTypes";

export type TaskStatus =
  | "IDLE"
  | "CREATED"
  | "RUNNING"
  | "WAITING_FOR_USER"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface Task {
  id: string;
  session_id: string;
  repo_key: string;
  title: string;
  prompt: string;
  wrapped_prompt: string;
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

export type PublicTask = Omit<Task, "wrapped_prompt">;
