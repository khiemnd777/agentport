import type { CodexSession, PublicRepo } from "../../api/client";
import RepoSwitcher from "../repos/RepoSwitcher";
import CreateSessionButton from "../sessions/CreateSessionButton";
import SessionList from "../sessions/SessionList";

interface Props {
  repos: PublicRepo[];
  selectedRepoKey: string | null;
  sessions: CodexSession[];
  activeSessionId: string | null;
  showHistory: boolean;
  onSelectRepo: (repoKey: string) => void;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onToggleHistory: (showHistory: boolean) => void;
  onArchiveSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

export default function Sidebar({
  repos,
  selectedRepoKey,
  sessions,
  activeSessionId,
  showHistory,
  onSelectRepo,
  onSelectSession,
  onCreateSession,
  onToggleHistory,
  onArchiveSession,
  onDeleteSession
}: Props) {
  return (
    <aside className="sidebar">
      <RepoSwitcher repos={repos} selectedRepoKey={selectedRepoKey} onSelect={onSelectRepo} />
      <CreateSessionButton disabled={!selectedRepoKey} onCreate={onCreateSession} />
      <div className="sidebar-section-row">
        <div className="sidebar-section-title">Sessions</div>
        <div className="session-view-toggle" aria-label="Session view">
          <button
            type="button"
            className={!showHistory ? "active" : ""}
            onClick={() => onToggleHistory(false)}
          >
            Active
          </button>
          <button
            type="button"
            className={showHistory ? "active" : ""}
            onClick={() => onToggleHistory(true)}
          >
            History
          </button>
        </div>
      </div>
      <SessionList
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={onSelectSession}
        onArchive={onArchiveSession}
        onDelete={onDeleteSession}
        emptyLabel={showHistory ? "No session history." : "No active sessions."}
      />
    </aside>
  );
}
