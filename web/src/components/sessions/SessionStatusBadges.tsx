import type { CodexSession, ControlState, SyncStatus } from "../../api/client";
import TaskStatusBadge from "../tasks/TaskStatusBadge";
import SessionStatusBadge from "./SessionStatusBadge";

interface Props {
  session: CodexSession;
}

export default function SessionStatusBadges({ session }: Props) {
  return (
    <>
      {session.codex_thread_id ? (
        <>
          <span className="status-badge codex-thread">Codex thread</span>
          <span className={`status-badge sync-${session.sync_status.replaceAll("_", "-")}`}>
            {formatSyncStatus(session.sync_status)}
          </span>
          <span className={`status-badge control-${session.control_state.replaceAll("_", "-")}`}>
            {formatControlState(session.control_state)}
          </span>
        </>
      ) : (
        <>
          <SessionStatusBadge status={session.terminal_status} />
          <TaskStatusBadge status={session.task_status} />
        </>
      )}
      {session.archived_at ? <span className="status-badge session-archived">ARCHIVED</span> : null}
    </>
  );
}

function formatSyncStatus(status: SyncStatus): string {
  return status.replaceAll("_", " ");
}

function formatControlState(state: ControlState): string {
  switch (state) {
    case "desktop_active":
      return "Desktop active";
    case "mobile_control":
      return "Mobile control";
    case "observing":
      return "Observing";
    case "idle":
      return "Idle";
  }
}
