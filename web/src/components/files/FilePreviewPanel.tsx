import { AlertCircle, File as FileIcon, Loader2, X } from "lucide-react";
import type { FilePreview } from "../../api/client";

export type FilePreviewState =
  | { status: "loading"; label: string }
  | { status: "ready"; file: FilePreview }
  | { status: "error"; label: string; message: string };

export default function FilePreviewPanel({ preview, onClose }: { preview: FilePreviewState; onClose: () => void }) {
  const title = preview.status === "ready" ? preview.file.name : preview.label;
  const pathText = preview.status === "ready" ? preview.file.path : null;

  return (
    <section className={`chat-file-preview ${preview.status}`} aria-label="File preview">
      <header className="chat-file-preview-header">
        <span className="chat-file-preview-title">
          <FileIcon size={17} />
          <span>
            <strong>{title}</strong>
            {pathText ? <small>{pathText}</small> : null}
          </span>
        </span>
        <button className="icon-button" type="button" onClick={onClose} title="Close file preview">
          <X size={17} />
        </button>
      </header>
      {preview.status === "loading" ? (
        <div className="chat-file-preview-state">
          <Loader2 size={17} className="spin" /> Loading {preview.label}...
        </div>
      ) : null}
      {preview.status === "error" ? (
        <div className="chat-file-preview-state error">
          <AlertCircle size={17} /> {preview.message}
        </div>
      ) : null}
      {preview.status === "ready" ? (
        <pre className="chat-file-preview-code">
          <code>{preview.file.content}</code>
        </pre>
      ) : null}
    </section>
  );
}
