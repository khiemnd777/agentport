import { RefreshCw } from "lucide-react";
import type { GitStatus } from "../../api/client";
import ChangedFilesList from "./ChangedFilesList";
import DiffViewer from "./DiffViewer";

interface Props {
  status: GitStatus | null;
  diff: string;
  selectedFile: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onSelectFile: (file: string | null) => void;
}

export default function GitStatusPanel({
  status,
  diff,
  selectedFile,
  refreshing,
  onRefresh,
  onSelectFile
}: Props) {
  return (
    <section className="git-panel">
      <div className="panel-title-row">
        <div>
          <div className="panel-heading">Changes</div>
          <span className="muted">{status?.branch ?? "No branch"}</span>
        </div>
        <button className="icon-button" type="button" onClick={onRefresh} title="Refresh git status">
          <RefreshCw size={16} className={refreshing ? "spin" : ""} />
        </button>
      </div>
      <ChangedFilesList files={status?.files ?? []} selectedFile={selectedFile} onSelect={onSelectFile} />
      {status && !status.isRepository ? <div className="warning-banner">{status.error}</div> : null}
      <DiffViewer diff={diff} />
    </section>
  );
}
