import { Archive, CalendarClock, MessageSquare, Trash2 } from "lucide-react";
import type { CodexSession } from "../../api/client";
import SessionStatusBadges from "./SessionStatusBadges";
import { formatDateTime } from "./sessionDate";

interface Props {
  sessions: CodexSession[];
  activeSessionId: string | null;
  view?: "active" | "archive";
  selectionEnabled?: boolean;
  selectedSessionIds?: Set<string>;
  onSelect: (sessionId: string) => void;
  onToggleSelection?: (sessionId: string, selected: boolean) => void;
  onArchive: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  emptyLabel?: string;
}

export default function SessionList({
  sessions,
  activeSessionId,
  view = "active",
  selectionEnabled = false,
  selectedSessionIds = new Set<string>(),
  onSelect,
  onToggleSelection,
  onArchive,
  onDelete,
  emptyLabel
}: Props) {
  if (sessions.length === 0) {
    return <div className="empty-state">{emptyLabel ?? "No active sessions."}</div>;
  }

  return (
    <div className="session-list">
      {sessions.map((session) => {
        const stopped = ["DISCONNECTED", "CLOSED", "ERROR"].includes(session.terminal_status);
        const canArchive = stopped && !session.archived_at;
        const canDelete = stopped || Boolean(session.archived_at);
        const selected = selectedSessionIds.has(session.id);
        const dateMeta = formatSessionDate(session, view);
        return (
          <div
            className={`session-row ${selectionEnabled ? "with-selection" : ""} ${canArchive || canDelete ? "has-actions" : ""} ${session.id === activeSessionId ? "active" : ""} ${selected ? "selected" : ""}`}
            key={session.id}
          >
            {selectionEnabled ? (
              <label className="session-row-selector" aria-label={`Select ${session.title}`}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(event) => onToggleSelection?.(session.id, event.currentTarget.checked)}
                />
              </label>
            ) : null}
            <button type="button" className="session-row-main" onClick={() => onSelect(session.id)}>
              <span className="session-row-title" title={session.title}>
                {view === "archive" ? null : <MessageSquare size={15} />}
                <span className="session-row-title-text">{session.title}</span>
              </span>
              <span className="session-row-date" title={dateMeta.accessibleLabel} aria-label={dateMeta.accessibleLabel}>
                <CalendarClock size={14} />
                <span>{dateMeta.label}</span>
              </span>
              <span className="session-row-meta">
                <SessionStatusBadges session={session} />
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

function formatSessionDate(session: CodexSession, view: "active" | "archive"): { label: string; accessibleLabel: string } {
  if (view === "archive") {
    const label = formatDateTime(session.archived_at ?? session.updated_at);
    return { label, accessibleLabel: `Archived ${label}` };
  }
  if (session.codex_thread_updated_at) {
    const label = formatDateTime(session.codex_thread_updated_at);
    return { label, accessibleLabel: `Updated ${label}` };
  }
  const label = formatDateTime(session.updated_at);
  return { label, accessibleLabel: `Updated ${label}` };
}
