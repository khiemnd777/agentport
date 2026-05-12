import type { ReactNode } from "react";
import { FileDiff, TerminalSquare } from "lucide-react";

export type InspectorTab = "console" | "changes";

interface Props {
  activeTab: InspectorTab;
  consolePanel: ReactNode;
  changesPanel: ReactNode;
  onTabChange: (tab: InspectorTab) => void;
}

export default function InspectorPanel({ activeTab, consolePanel, changesPanel, onTabChange }: Props) {
  return (
    <aside className="inspector-panel">
      <div className="inspector-tabs" aria-label="Session inspector">
        <button
          type="button"
          className={activeTab === "console" ? "active" : ""}
          onClick={() => onTabChange("console")}
        >
          <TerminalSquare size={16} /> Console
        </button>
        <button
          type="button"
          className={activeTab === "changes" ? "active" : ""}
          onClick={() => onTabChange("changes")}
        >
          <FileDiff size={16} /> Changes
        </button>
      </div>
      <div className="inspector-content">{activeTab === "console" ? consolePanel : changesPanel}</div>
    </aside>
  );
}
