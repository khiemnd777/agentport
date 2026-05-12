export type SessionSource = "iphone_web" | "desktop_web" | "local_cli" | "automation";

export type ControlMode = "web_managed" | "local_terminal" | "non_interactive";

export type TerminalStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RUNNING"
  | "CLOSED"
  | "ERROR";

export interface WaitingUserInputOption {
  label: string;
  description: string;
}

export interface WaitingUserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: WaitingUserInputOption[] | null;
}

export interface WaitingUserInput {
  kind: "user_input";
  message: string;
  questions: WaitingUserInputQuestion[];
  requested_at: string;
}

export interface CodexSession {
  id: string;
  repo_key: string;
  repo_path: string;
  branch_name: string | null;
  title: string;
  source: SessionSource;
  control_mode: ControlMode;
  terminal_status: TerminalStatus;
  task_status: import("./taskTypes").TaskStatus;
  active_task_id: string | null;
  codex_thread_id: string | null;
  waiting_user_input: WaitingUserInput | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  closed_at: string | null;
  last_output_at: string | null;
  archived_at: string | null;
}

export type PublicCodexSession = Omit<CodexSession, "repo_path">;
