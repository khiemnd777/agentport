import { useEffect, useRef } from "react";
import type { CodexHistoryThread, CodexSession, PublicRepo } from "../../api/client";
import RepoSwitcher from "../repos/RepoSwitcher";
import CreateSessionButton from "../sessions/CreateSessionButton";
import CodexHistoryList from "../sessions/CodexHistoryList";
import SessionList from "../sessions/SessionList";

export type SessionSidebarView = "active" | "archive" | "history";

interface Props {
  repos: PublicRepo[];
  selectedRepoKey: string | null;
  sessions: CodexSession[];
  codexHistoryThreads: CodexHistoryThread[];
  activeSessionId: string | null;
  view: SessionSidebarView;
  selectedArchiveSessionIds: Set<string>;
  hasMore: boolean;
  loadingMore: boolean;
  onSelectRepo: (repoKey: string) => void;
  onManageRepos: () => void;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onViewChange: (view: SessionSidebarView) => void;
  onToggleArchiveSessionSelection: (sessionId: string, selected: boolean) => void;
  onToggleAllArchiveSessions: (selected: boolean) => void;
  onOpenCodexHistoryThread: (thread: CodexHistoryThread) => void;
  onArchiveSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onDeleteSelectedArchiveSessions: () => void;
  onLoadMore: () => void;
}

export default function Sidebar({
  repos,
  selectedRepoKey,
  sessions,
  codexHistoryThreads,
  activeSessionId,
  view,
  selectedArchiveSessionIds,
  hasMore,
  loadingMore,
  onSelectRepo,
  onManageRepos,
  onSelectSession,
  onCreateSession,
  onViewChange,
  onToggleArchiveSessionSelection,
  onToggleAllArchiveSessions,
  onOpenCodexHistoryThread,
  onArchiveSession,
  onDeleteSession,
  onDeleteSelectedArchiveSessions,
  onLoadMore
}: Props) {
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const selectedArchiveCount = view === "archive"
    ? sessions.filter((session) => selectedArchiveSessionIds.has(session.id)).length
    : 0;
  const allArchiveSelected = view === "archive" && sessions.length > 0 && selectedArchiveCount === sessions.length;

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || loadingMore) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          onLoadMore();
        }
      },
      { root: null, rootMargin: "160px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore, view]);

  return (
    <aside className="sidebar">
      <RepoSwitcher repos={repos} selectedRepoKey={selectedRepoKey} onSelect={onSelectRepo} onManage={onManageRepos} />
      <CreateSessionButton disabled={!selectedRepoKey} onCreate={onCreateSession} />
      <div className="sidebar-section-row">
        <div className="sidebar-section-title">Sessions</div>
        <div className="session-view-toggle" aria-label="Session view">
          <button
            type="button"
            className={view === "active" ? "active" : ""}
            onClick={() => onViewChange("active")}
          >
            Active
          </button>
          <button
            type="button"
            className={view === "archive" ? "active" : ""}
            onClick={() => onViewChange("archive")}
          >
            Archive
          </button>
          <button
            type="button"
            className={view === "history" ? "active" : ""}
            onClick={() => onViewChange("history")}
          >
            History
          </button>
        </div>
      </div>
      {view === "archive" ? (
        <div className="history-bulk-bar">
          <label className="history-select-all">
            <input
              type="checkbox"
              checked={allArchiveSelected}
              disabled={sessions.length === 0}
              onChange={(event) => onToggleAllArchiveSessions(event.currentTarget.checked)}
            />
            Select visible
          </label>
          <span className="history-selected-count">{selectedArchiveCount} selected</span>
          <button
            type="button"
            className="history-bulk-delete"
            disabled={selectedArchiveCount === 0}
            onClick={onDeleteSelectedArchiveSessions}
          >
            Delete selected
          </button>
        </div>
      ) : null}
      <div className="session-scroll-region">
        {view === "history" ? (
          <CodexHistoryList threads={codexHistoryThreads} onOpen={onOpenCodexHistoryThread} />
        ) : (
          <SessionList
            sessions={sessions}
            activeSessionId={activeSessionId}
            view={view}
            selectionEnabled={view === "archive"}
            selectedSessionIds={selectedArchiveSessionIds}
            onSelect={onSelectSession}
            onToggleSelection={onToggleArchiveSessionSelection}
            onArchive={onArchiveSession}
            onDelete={onDeleteSession}
            emptyLabel={view === "archive" ? "No archived sessions." : "No active sessions."}
          />
        )}
        <div ref={loadMoreRef} className="session-load-more-sentinel" aria-hidden="true" />
        {hasMore ? (
          <button
            type="button"
            className="session-load-more"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
