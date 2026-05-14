import { CalendarClock, History, RotateCw } from "lucide-react";
import type { CodexHistoryThread, ControlState } from "../../api/client";
import { formatDateTime } from "./sessionDate";

interface Props {
  threads: CodexHistoryThread[];
  onOpen: (thread: CodexHistoryThread) => void;
}

export default function CodexHistoryList({ threads, onOpen }: Props) {
  if (threads.length === 0) {
    return <div className="empty-state">No Codex history.</div>;
  }

  return (
    <div className="session-list">
      {threads.map((thread) => {
        const dateMeta = formatHistoryDate(thread);
        return (
          <div className="session-row history-thread-row has-actions" key={`${thread.repo_key}:${thread.id}`}>
            <button type="button" className="session-row-main" onClick={() => onOpen(thread)}>
              <span className="session-row-title" title={thread.title}>
                <History size={15} />
                <span className="session-row-title-text">{thread.title}</span>
              </span>
              <span className="session-row-date" title={dateMeta.accessibleLabel} aria-label={dateMeta.accessibleLabel}>
                <CalendarClock size={14} />
                <span>{dateMeta.label}</span>
              </span>
              <span className="session-row-meta">
                <span className="status-badge codex-thread">Codex history</span>
                <span className="status-badge session-repo">{thread.repo_label}</span>
                <span className={`status-badge control-${thread.control_state.replaceAll("_", "-")}`}>
                  {formatControlState(thread.control_state)}
                </span>
                {thread.imported_session_id ? <span className="status-badge sync-synced">Synced</span> : null}
                {thread.forgotten ? <span className="status-badge session-archived">Forgotten locally</span> : null}
              </span>
            </button>
            <span className="session-row-actions">
              <button
                type="button"
                className="icon-button compact"
                title="Restore history thread"
                aria-label={`Restore ${thread.title}`}
                onClick={() => onOpen(thread)}
              >
                <RotateCw size={14} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatHistoryDate(thread: CodexHistoryThread): { label: string; accessibleLabel: string } {
  if (thread.updated_at) {
    const label = formatDateTime(thread.updated_at);
    return { label, accessibleLabel: `Updated ${label}` };
  }
  const label = formatDateTime(thread.created_at);
  return { label, accessibleLabel: `Created ${label}` };
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
