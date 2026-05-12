import { Archive, MessageSquare, Trash2 } from "lucide-react";
import type { CodexSession } from "../../api/client";
import SessionStatusBadge from "./SessionStatusBadge";
import TaskStatusBadge from "../tasks/TaskStatusBadge";

interface Props {
  sessions: CodexSession[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onArchive: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  emptyLabel?: string;
}

export default function SessionList({ sessions, activeSessionId, onSelect, onArchive, onDelete, emptyLabel }: Props) {
  if (sessions.length === 0) {
    return <div className="empty-state">{emptyLabel ?? "No active sessions."}</div>;
  }

  return (
    <div className="session-list">
      {sessions.map((session) => {
        const stopped = ["DISCONNECTED", "CLOSED", "ERROR"].includes(session.terminal_status);
        const canArchive = stopped && !session.archived_at;
        const canDelete = stopped || Boolean(session.archived_at);
        return (
          <div className={`session-row ${session.id === activeSessionId ? "active" : ""}`} key={session.id}>
            <button type="button" className="session-row-main" onClick={() => onSelect(session.id)}>
              <span className="session-row-title">
                <MessageSquare size={15} /> {session.title}
              </span>
              <span className="session-row-meta">
                <SessionStatusBadge status={session.terminal_status} />
                <TaskStatusBadge status={session.task_status} />
                {session.archived_at ? <span className="status-badge session-archived">ARCHIVED</span> : null}
              </span>
            </button>
            {canArchive || canDelete ? (
              <span className="session-row-actions">
                {canArchive ? (
                  <button
                    type="button"
                    className="icon-button compact"
                    title="Archive session"
                    aria-label={`Archive ${session.title}`}
                    onClick={() => onArchive(session.id)}
                  >
                    <Archive size={14} />
                  </button>
                ) : null}
                {canDelete ? (
                  <button
                    type="button"
                    className="icon-button compact danger"
                    title="Delete session"
                    aria-label={`Delete ${session.title}`}
                    onClick={() => onDelete(session.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
