import type { GitChangedFile } from "../../api/client";

interface Props {
  files: GitChangedFile[];
  selectedFile: string | null;
  onSelect: (file: string | null) => void;
}

export default function ChangedFilesList({ files, selectedFile, onSelect }: Props) {
  if (files.length === 0) {
    return <div className="empty-state">No working tree changes.</div>;
  }

  const totals = summarizeFiles(files);

  return (
    <div className="changed-files">
      <button type="button" className={`changed-file-row summary ${!selectedFile ? "active" : ""}`} onClick={() => onSelect(null)}>
        <span className="changed-file-main">
          <span className="changed-file-name">All changes</span>
          <span className="changed-file-dir">{files.length} {files.length === 1 ? "file" : "files"} changed</span>
        </span>
        <ChangeStats additions={totals.additions} deletions={totals.deletions} />
      </button>
      <div className="changed-files-list">
        {files.map((file) => {
          const pathParts = splitPath(file.path);
          const status = getFileStatus(file);
          return (
            <button
              type="button"
              key={`${file.indexStatus}${file.worktreeStatus}${file.path}`}
              className={`changed-file-row ${selectedFile === file.path ? "active" : ""}`}
              onClick={() => onSelect(file.path)}
            >
              <span className={`file-status ${status.kind}`}>{status.label}</span>
              <span className="changed-file-main">
                <span className="changed-file-name">{pathParts.name}</span>
                <span className="changed-file-dir">
                  {file.originalPath ? `${file.originalPath} -> ` : null}
                  {pathParts.dir || "./"}
                </span>
              </span>
              <ChangeStats additions={file.additions} deletions={file.deletions} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChangeStats({ additions, deletions }: { additions?: number; deletions?: number }) {
  const hasAdditions = typeof additions === "number";
  const hasDeletions = typeof deletions === "number";
  if (!hasAdditions && !hasDeletions) {
    return <span className="change-stats empty" aria-hidden="true" />;
  }
  return (
    <span className="change-stats">
      {hasAdditions ? <span className="change-stat additions">+{additions}</span> : null}
      {hasDeletions ? <span className="change-stat deletions">-{deletions}</span> : null}
    </span>
  );
}

function summarizeFiles(files: GitChangedFile[]): { additions?: number; deletions?: number } {
  let additions = 0;
  let deletions = 0;
  let hasStats = false;
  for (const file of files) {
    if (typeof file.additions === "number") {
      additions += file.additions;
      hasStats = true;
    }
    if (typeof file.deletions === "number") {
      deletions += file.deletions;
      hasStats = true;
    }
  }
  return hasStats ? { additions, deletions } : {};
}

function splitPath(filePath: string): { dir: string; name: string } {
  const parts = filePath.split("/");
  const name = parts.pop() || filePath;
  return {
    dir: parts.join("/"),
    name
  };
}

function getFileStatus(file: GitChangedFile): { label: string; kind: string } {
  const combined = `${file.indexStatus}${file.worktreeStatus}`;
  if (combined.includes("?")) {
    return { label: "?", kind: "untracked" };
  }
  if (combined.includes("U")) {
    return { label: "U", kind: "conflict" };
  }
  if (combined.includes("R")) {
    return { label: "R", kind: "renamed" };
  }
  if (combined.includes("A")) {
    return { label: "A", kind: "added" };
  }
  if (combined.includes("D")) {
    return { label: "D", kind: "deleted" };
  }
  if (combined.includes("M")) {
    return { label: "M", kind: "modified" };
  }
  return { label: combined.trim() || "•", kind: "modified" };
}
