import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { GitStatus } from "../../api/client";
import { getSessionFileContent } from "../../api/filesApi";
import FilePreviewPanel, { type FilePreviewState } from "../files/FilePreviewPanel";
import ChangedFilesList from "./ChangedFilesList";
import DiffViewer from "./DiffViewer";

interface Props {
  sessionId: string | null;
  status: GitStatus | null;
  diff: string;
  selectedFile: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onSelectFile: (file: string | null) => void;
}

export default function GitStatusPanel({
  sessionId,
  status,
  diff,
  selectedFile,
  refreshing,
  onRefresh,
  onSelectFile
}: Props) {
  const [filePreview, setFilePreview] = useState<FilePreviewState | null>(null);

  function handleSelectFile(file: string | null) {
    setFilePreview(null);
    onSelectFile(file);
  }

  async function handleOpenFile(file: string) {
    if (!sessionId) {
      return;
    }
    const label = basenameFromPath(file);
    setFilePreview({ status: "loading", label });
    try {
      const result = await getSessionFileContent(sessionId, { file });
      setFilePreview({ status: "ready", file: result.file });
    } catch (error) {
      setFilePreview({
        status: "error",
        label,
        message: error instanceof Error ? error.message : "Cannot open file from this session."
      });
    }
  }

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
      <ChangedFilesList
        files={status?.files ?? []}
        selectedFile={selectedFile}
        onSelect={handleSelectFile}
        onOpenFile={handleOpenFile}
      />
      {status && !status.isRepository ? <div className="warning-banner">{status.error}</div> : null}
      {filePreview ? <FilePreviewPanel preview={filePreview} onClose={() => setFilePreview(null)} /> : null}
      <DiffViewer diff={diff} />
    </section>
  );
}

function basenameFromPath(filePath: string): string {
  return filePath.split(/[\\/]+/).filter(Boolean).pop() ?? filePath;
}
