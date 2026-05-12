import type { ReactNode } from "react";
import { GitBranch, LogOut, Monitor, Moon, PanelRightClose, RefreshCw, Sun, X } from "lucide-react";
import type { CodexSession, PublicRepo } from "../../api/client";
import type { DisplayMode } from "../../theme";
import SessionStatusBadge from "../sessions/SessionStatusBadge";
import TaskStatusBadge from "../tasks/TaskStatusBadge";

interface Props {
  activeSession: CodexSession | null;
  selectedRepo: PublicRepo | null;
  refreshing: boolean;
  displayMode: DisplayMode;
  onRefresh: () => void;
  onCloseSession: () => void;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onLogout: () => void;
  notificationControl?: ReactNode;
}

export default function TopBar({
  activeSession,
  selectedRepo,
  refreshing,
  displayMode,
  onRefresh,
  onCloseSession,
  onDisplayModeChange,
  onLogout,
  notificationControl
}: Props) {
  const nextDisplayMode: DisplayMode = displayMode === "system" ? "dark" : displayMode === "dark" ? "light" : "system";
  const displayModeLabel =
    displayMode === "system" ? "System display mode" : displayMode === "dark" ? "Dark mode" : "Light mode";
  const nextDisplayModeLabel =
    nextDisplayMode === "system" ? "system display mode" : nextDisplayMode === "dark" ? "dark mode" : "light mode";

  return (
    <header className="topbar">
      <div className="topbar-title">
        <strong>Agent Port</strong>
        <span>{selectedRepo?.label ?? "No repository"}</span>
      </div>
      <div className="topbar-status">
        {activeSession?.branch_name ? (
          <span className="branch-chip">
            <GitBranch size={14} /> {activeSession.branch_name}
          </span>
        ) : null}
        {activeSession ? (
          <>
            <SessionStatusBadge status={activeSession.terminal_status} />
            <TaskStatusBadge status={activeSession.task_status} />
            <span className="mode-chip">{activeSession.control_mode.replace("_", " ")}</span>
          </>
        ) : null}
      </div>
      <div className="topbar-actions">
        {notificationControl}
        <div className="display-mode-toggle" aria-label="Display mode">
          <button
            type="button"
            className={displayMode === "light" ? "active" : ""}
            aria-pressed={displayMode === "light"}
            onClick={() => onDisplayModeChange("light")}
            title="Light mode"
          >
            <Sun size={15} /> <span>Light</span>
          </button>
          <button
            type="button"
            className={displayMode === "dark" ? "active" : ""}
            aria-pressed={displayMode === "dark"}
            onClick={() => onDisplayModeChange("dark")}
            title="Dark mode"
          >
            <Moon size={15} /> <span>Dark</span>
          </button>
          <button
            type="button"
            className={displayMode === "system" ? "active" : ""}
            aria-pressed={displayMode === "system"}
            onClick={() => onDisplayModeChange("system")}
            title="Use system display mode"
          >
            <Monitor size={15} /> <span>System</span>
          </button>
        </div>
        <button
          className="icon-button mobile-display-mode-button"
          type="button"
          onClick={() => onDisplayModeChange(nextDisplayMode)}
          title={`${displayModeLabel}. Switch to ${nextDisplayModeLabel}`}
          aria-label={`${displayModeLabel}. Switch to ${nextDisplayModeLabel}`}
        >
          {displayMode === "light" ? <Sun size={17} /> : displayMode === "dark" ? <Moon size={17} /> : <Monitor size={17} />}
        </button>
        <button className="icon-button" type="button" onClick={onRefresh} title="Refresh">
          <RefreshCw size={17} className={refreshing ? "spin" : ""} />
        </button>
        <button
          className="icon-button"
          type="button"
          disabled={
            !activeSession ||
            Boolean(activeSession.archived_at) ||
            ["DISCONNECTED", "CLOSED", "ERROR"].includes(activeSession.terminal_status)
          }
          onClick={onCloseSession}
          title="Close session"
        >
          <X size={18} />
        </button>
        <button className="icon-button" type="button" onClick={onLogout} title="Sign out">
          <LogOut size={18} />
        </button>
      </div>
      <div className="mobile-brand">
        <PanelRightClose size={17} /> Agent Port
      </div>
    </header>
  );
}
