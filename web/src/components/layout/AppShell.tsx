import type { ReactNode } from "react";
import { FileDiff, List, MessageSquare, TerminalSquare } from "lucide-react";

export type MobileTab = "sessions" | "chat" | "console" | "changes";

interface Props {
  topBar: ReactNode;
  sidebar: ReactNode;
  chat: ReactNode;
  console: ReactNode;
  changes: ReactNode;
  inspector: ReactNode;
  mobileTab: MobileTab;
  onMobileTabChange: (tab: MobileTab) => void;
}

export default function AppShell({
  topBar,
  sidebar,
  chat,
  console,
  changes,
  inspector,
  mobileTab,
  onMobileTabChange
}: Props) {
  return (
    <div className="app-shell">
      {topBar}
      <div className="desktop-grid">
        {sidebar}
        <main className="chat-region">{chat}</main>
        {inspector}
      </div>
      <main className="mobile-panels">
        <section className={mobileTab === "sessions" ? "mobile-panel active" : "mobile-panel"}>{sidebar}</section>
        <section className={mobileTab === "chat" ? "mobile-panel active" : "mobile-panel"}>{chat}</section>
        <section className={mobileTab === "console" ? "mobile-panel active" : "mobile-panel"}>{console}</section>
        <section className={mobileTab === "changes" ? "mobile-panel active" : "mobile-panel"}>{changes}</section>
      </main>
      <nav className="mobile-tabs" aria-label="Agent Port sections">
        <button type="button" className={mobileTab === "sessions" ? "active" : ""} onClick={() => onMobileTabChange("sessions")}>
          <List size={18} /> Sessions
        </button>
        <button type="button" className={mobileTab === "chat" ? "active" : ""} onClick={() => onMobileTabChange("chat")}>
          <MessageSquare size={18} /> Chat
        </button>
        <button type="button" className={mobileTab === "console" ? "active" : ""} onClick={() => onMobileTabChange("console")}>
          <TerminalSquare size={18} /> Console
        </button>
        <button type="button" className={mobileTab === "changes" ? "active" : ""} onClick={() => onMobileTabChange("changes")}>
          <FileDiff size={18} /> Changes
        </button>
      </nav>
    </div>
  );
}
