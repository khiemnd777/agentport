import { ClipboardEvent, DragEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FileImage,
  FileVideo,
  GitBranch,
  ListChecks,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Square,
  TerminalSquare,
  X
} from "lucide-react";
import type {
  ChatAttachment,
  ChatMessage,
  CodexPermissionMode,
  CodexReasoningEffort,
  CodexSession,
  PublicCodexModel,
  PublicCodexPermissionMode,
  PublicCodexReasoningEffort,
  PublicRepo,
  WaitingUserInput
} from "../../api/client";
import { chatAttachmentContentUrl, uploadChatAttachment } from "../../api/chatApi";
import { getSessionFileContent } from "../../api/filesApi";
import FilePreviewPanel, { type FilePreviewState } from "../files/FilePreviewPanel";
import SessionStatusBadges from "../sessions/SessionStatusBadges";
import MarkdownContent, { type MarkdownFileLink } from "./MarkdownContent";

interface Props {
  activeSession: CodexSession | null;
  selectedRepo: PublicRepo | null;
  messages: ChatMessage[];
  turnBusy: boolean;
  models: PublicCodexModel[];
  selectedModel: string;
  reasoningEfforts: PublicCodexReasoningEffort[];
  selectedReasoningEffort: CodexReasoningEffort | "";
  permissionModes: PublicCodexPermissionMode[];
  selectedPermissionMode: CodexPermissionMode | "";
  planMode: boolean;
  onSelectedModelChange: (model: string) => void;
  onSelectedReasoningEffortChange: (reasoningEffort: CodexReasoningEffort) => void;
  onSelectedPermissionModeChange: (permissionMode: CodexPermissionMode) => void;
  onPlanModeChange: (enabled: boolean) => void;
  onSubmitMessage: (prompt: string, attachmentIds: string[]) => Promise<void>;
  onSubmitUserInput: (text: string) => Promise<void>;
  onStopTurn: () => Promise<void>;
  onCreateSession: () => void;
  onOpenConsole: () => void;
}

type ComposerAttachmentStatus = "pending" | "uploading" | "uploaded" | "error";

interface ComposerAttachment {
  localId: string;
  file: globalThis.File;
  status: ComposerAttachmentStatus;
  attachment: ChatAttachment | null;
  error: string | null;
}

export default function ChatWorkspace({
  activeSession,
  selectedRepo,
  messages,
  turnBusy,
  models,
  selectedModel,
  reasoningEfforts,
  selectedReasoningEffort,
  permissionModes,
  selectedPermissionMode,
  planMode,
  onSelectedModelChange,
  onSelectedReasoningEffortChange,
  onSelectedPermissionModeChange,
  onPlanModeChange,
  onSubmitMessage,
  onSubmitUserInput,
  onStopTurn,
  onCreateSession,
  onOpenConsole
}: Props) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [collapsedActivity, setCollapsedActivity] = useState<Record<string, boolean>>({});
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [filePreview, setFilePreview] = useState<FilePreviewState | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const waitingForUser = activeSession?.task_status === "WAITING_FOR_USER";
  const desktopActive = activeSession?.control_state === "desktop_active";
  const mobileControl = activeSession?.control_state === "mobile_control";
  const codexWorking = turnBusy && !waitingForUser;
  const composerDisabled = submitting || !activeSession || Boolean(activeSession?.archived_at) || desktopActive;
  const uploadedAttachmentIds = useMemo(
    () =>
      composerAttachments
        .filter((item) => item.status === "uploaded" && item.attachment)
        .map((item) => item.attachment?.id)
        .filter((id): id is string => Boolean(id)),
    [composerAttachments]
  );
  const hasAttachmentUploadPending = composerAttachments.some(
    (item) => item.status === "pending" || item.status === "uploading"
  );
  const hasAttachmentErrors = composerAttachments.some((item) => item.status === "error");
  const hasSendableContent = Boolean(draft.trim()) || uploadedAttachmentIds.length > 0;
  const attachmentControlsDisabled = composerDisabled || turnBusy;
  const planModeDisabled = composerDisabled || turnBusy;
  const canStopTurn = turnBusy && mobileControl;
  const sendDisabled =
    composerDisabled || turnBusy || hasAttachmentUploadPending || hasAttachmentErrors || !hasSendableContent;

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [messages]
  );
  const scrollSignature = useMemo(
    () =>
      sortedMessages
        .map((message) => {
          const activitySignature = message.activities
            .map((activity) => `${activity.id}:${activity.status}:${activity.content.length}`)
            .join(",");
          const attachmentSignature = (message.attachments ?? [])
            .map((attachment) => `${attachment.id}:${attachment.mime_type}:${attachment.size_bytes}`)
            .join(",");
          return `${message.id}:${message.status}:${message.content.length}:${activitySignature}:${attachmentSignature}`;
        })
        .join("|"),
    [sortedMessages]
  );
  const lastMessage = sortedMessages[sortedMessages.length - 1] ?? null;
  const shouldFollowStream = turnBusy || lastMessage?.status === "streaming";

  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    const threadEnd = threadEndRef.current;
    if (!scrollArea || !threadEnd || !activeSession) {
      return;
    }

    const behavior: ScrollBehavior = shouldFollowStream ? "auto" : "smooth";
    window.requestAnimationFrame(() => {
      threadEnd.scrollIntoView({ block: "end", behavior });
    });
  }, [activeSession?.id, scrollSignature, shouldFollowStream]);

  useEffect(() => {
    setComposerAttachments([]);
    setDragActive(false);
    dragDepthRef.current = 0;
    setFilePreview(null);
  }, [activeSession?.id]);

  function addFiles(files: FileList | globalThis.File[]) {
    if (!activeSession || attachmentControlsDisabled) {
      return;
    }
    const selectedFiles = Array.from(files).filter((file) => file.name);
    if (selectedFiles.length === 0) {
      return;
    }
    const sessionId = activeSession.id;
    const nextAttachments: ComposerAttachment[] = selectedFiles.map((file) => ({
      localId: createLocalAttachmentId(),
      file,
      status: "pending",
      attachment: null,
      error: null
    }));
    setComposerAttachments((current) => [...current, ...nextAttachments]);
    for (const item of nextAttachments) {
      void uploadComposerAttachment(item.localId, sessionId, item.file);
    }
  }

  async function uploadComposerAttachment(localId: string, sessionId: string, file: globalThis.File) {
    setComposerAttachments((current) =>
      current.map((item) => (item.localId === localId ? { ...item, status: "uploading", error: null } : item))
    );
    try {
      const result = await uploadChatAttachment(sessionId, file);
      const attachment = result.attachment;
      if (!attachment.id) {
        throw new Error("Upload did not return an attachment id.");
      }
      setComposerAttachments((current) =>
        current.map((item) =>
          item.localId === localId ? { ...item, status: "uploaded", attachment, error: null } : item
        )
      );
    } catch (err) {
      setComposerAttachments((current) =>
        current.map((item) =>
          item.localId === localId
            ? { ...item, status: "error", attachment: null, error: (err as Error).message }
            : item
        )
      );
    }
  }

  function removeComposerAttachment(localId: string) {
    setComposerAttachments((current) => current.filter((item) => item.localId !== localId));
  }

  function handleFileInputChange(event: FormEvent<HTMLInputElement>) {
    const files = event.currentTarget.files;
    if (files) {
      addFiles(files);
    }
    event.currentTarget.value = "";
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0 || attachmentControlsDisabled) {
      return;
    }
    event.preventDefault();
    addFiles(files);
  }

  function handleComposerDragEnter(event: DragEvent<HTMLFormElement>) {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    if (!attachmentControlsDisabled) {
      setDragActive(true);
    }
  }

  function handleComposerDragOver(event: DragEvent<HTMLFormElement>) {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = attachmentControlsDisabled ? "none" : "copy";
  }

  function handleComposerDragLeave(event: DragEvent<HTMLFormElement>) {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragActive(false);
    }
  }

  function handleComposerDrop(event: DragEvent<HTMLFormElement>) {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (!attachmentControlsDisabled && event.dataTransfer.files.length > 0) {
      addFiles(event.dataTransfer.files);
    }
  }

  async function sendDraft() {
    if (sendDisabled) {
      return;
    }
    const text = draft.trim();
    setSubmitting(true);
    try {
      await onSubmitMessage(text, uploadedAttachmentIds);
      setDraft("");
      setComposerAttachments([]);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await sendDraft();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || !event.metaKey || event.shiftKey || event.altKey || event.ctrlKey) {
      return;
    }
    event.preventDefault();
    void sendDraft();
  }

  async function handleCancel() {
    if (!turnBusy || cancelling) {
      return;
    }
    setCancelling(true);
    try {
      await onStopTurn();
    } finally {
      setCancelling(false);
    }
  }

  async function handleOpenFileLink(link: MarkdownFileLink) {
    if (!activeSession) {
      return;
    }
    const lookup = fileLookupFromMarkdownLink(link);
    setFilePreview({ status: "loading", label: lookup.label });
    try {
      const result = await getSessionFileContent(activeSession.id, lookup.query);
      setFilePreview({ status: "ready", file: result.file });
    } catch (error) {
      setFilePreview({
        status: "error",
        label: lookup.label,
        message: error instanceof Error ? error.message : "Cannot open file from this chat."
      });
    }
  }

  const placeholder = (() => {
    if (!activeSession) {
      return "Create a chat first.";
    }
    if (activeSession.archived_at) {
      return "Archived chat is read-only.";
    }
    if (waitingForUser) {
      return "Codex is waiting for confirmation...";
    }
    if (desktopActive) {
      return "Codex Desktop is running this thread. Agent Port is observing.";
    }
    if (codexWorking) {
      return "Codex is working...";
    }
    if (sortedMessages.length > 0) {
      return "Ask for follow-up changes";
    }
    return "Ask Codex to work in this repo...";
  })();

  return (
    <section className="chat-workspace">
      <header className="chat-header">
        <div className="chat-title-block">
          <h1>{activeSession?.title ?? "New Codex chat"}</h1>
          <div className="chat-meta">
            <span className="chat-meta-repo">{selectedRepo?.label ?? activeSession?.repo_key ?? "No repository"}</span>
            {activeSession?.branch_name ? (
              <span className="chat-meta-branch">
                <GitBranch size={14} /> {activeSession.branch_name}
              </span>
            ) : null}
          </div>
        </div>
        <div className="chat-header-actions">
          {activeSession ? (
            <SessionStatusBadges session={activeSession} />
          ) : null}
          <button className="icon-button" type="button" onClick={onOpenConsole} title="Open console">
            <TerminalSquare size={17} />
          </button>
        </div>
      </header>

      {filePreview ? <FilePreviewPanel preview={filePreview} onClose={() => setFilePreview(null)} /> : null}

      <div className="chat-scroll" ref={scrollAreaRef}>
        <div className="chat-system-note">
          <MessageSquare size={17} />
          <span>
            {activeSession?.codex_thread_id
              ? "This chat is synced with the Codex thread store. Codex Desktop and Agent Port can continue the same thread when it is idle."
              : "This browser chat will create a synced Codex thread when you send the first message."}
          </span>
        </div>
        {activeSession?.last_sync_error ? (
          <div className="chat-sync-warning">
            <AlertCircle size={16} />
            <span>Codex thread sync failed: {activeSession.last_sync_error}</span>
          </div>
        ) : null}

        {!activeSession ? (
          <div className="chat-empty-state">
            <h2>No chat selected</h2>
            <p>Create a chat in the selected whitelisted repo to start a local Codex CLI session.</p>
            <button className="icon-text-button primary" type="button" disabled={!selectedRepo} onClick={onCreateSession}>
              <Plus size={17} /> New Chat
            </button>
          </div>
        ) : sortedMessages.length ? (
          <div className="chat-thread">
            {sortedMessages.map((message) => {
              const visibleAssistantContent = message.role === "assistant" ? getVisibleAssistantContent(message) : "";
              return (
                <article className={`chat-message ${message.role === "user" ? "user" : "assistant"}`} key={message.id}>
                  {message.role === "assistant" ? (
                    <div className="assistant-response">
                      <AssistantActivityGroup
                        message={message}
                        collapsed={collapsedActivity[message.id] ?? message.status !== "streaming"}
                        onFileLinkClick={handleOpenFileLink}
                        onToggle={() =>
                          setCollapsedActivity((current) => ({
                            ...current,
                            [message.id]: !(current[message.id] ?? message.status !== "streaming")
                          }))
                        }
                      />
                      {visibleAssistantContent ? (
                        <MarkdownContent content={visibleAssistantContent} onFileLinkClick={handleOpenFileLink} />
                      ) : message.activities.length === 0 && message.status === "streaming" ? (
                        <p className="thinking-placeholder">Thinking...</p>
                      ) : null}
                      {message.error ? <p className="error-text">{message.error}</p> : null}
                    </div>
                  ) : (
                    <div className="user-message-bubble">
                      <MessageAttachmentList message={message} />
                      {message.content ? <p>{message.content}</p> : null}
                    </div>
                  )}
                </article>
              );
            })}
            <div className="chat-thread-end" ref={threadEndRef} aria-hidden="true" />
          </div>
        ) : (
          <div className="chat-empty-state">
            <h2>Ready in {activeSession.repo_key}</h2>
            <p>Send a message below to start the first managed task in this session.</p>
          </div>
        )}
      </div>

      {waitingForUser ? (
        <WaitingUserInputComposer
          waitingInput={activeSession?.waiting_user_input ?? null}
          cancelling={cancelling}
          onFileLinkClick={handleOpenFileLink}
          onSubmit={onSubmitUserInput}
          onStop={() => void handleCancel()}
        />
      ) : (
        <form
          className={`${turnBusy ? "chat-composer waiting" : "chat-composer"}${dragActive ? " dragging-files" : ""}`}
          onSubmit={handleSubmit}
          onDragEnter={handleComposerDragEnter}
          onDragOver={handleComposerDragOver}
          onDragLeave={handleComposerDragLeave}
          onDrop={handleComposerDrop}
        >
          <div className="composer-card">
            <input
              className="sr-only"
              ref={fileInputRef}
              type="file"
              multiple
              disabled={attachmentControlsDisabled}
              onChange={handleFileInputChange}
            />
            {dragActive ? <div className="composer-drop-hint">Drop files to attach</div> : null}
            {composerAttachments.length > 0 ? (
              <ComposerAttachmentTray attachments={composerAttachments} onRemove={removeComposerAttachment} />
            ) : null}
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              onPaste={handleComposerPaste}
              placeholder={placeholder}
              disabled={composerDisabled || turnBusy}
              rows={2}
            />
            <div className="composer-toolbar">
              <div className="composer-toolbar-left">
                <button
                  className="composer-icon-button muted"
                  type="button"
                  disabled={attachmentControlsDisabled}
                  title="Attach files"
                  aria-label="Attach files"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip size={20} />
                </button>
                <PermissionModePicker
                  permissionModes={permissionModes}
                  selectedPermissionMode={selectedPermissionMode}
                  disabled={permissionModes.length === 0 || turnBusy}
                  onSelectedPermissionModeChange={onSelectedPermissionModeChange}
                />
                <button
                  className={planMode ? "composer-plan-trigger active" : "composer-plan-trigger"}
                  type="button"
                  disabled={planModeDisabled}
                  aria-pressed={planMode}
                  title="Managed plan-first mode for app-server"
                  onClick={() => onPlanModeChange(!planMode)}
                >
                  <ListChecks size={18} />
                  <span>Plan</span>
                </button>
              </div>
              <div className="composer-toolbar-right">
                {turnBusy ? (
                  <span className="composer-busy-indicator">
                    <span aria-hidden="true" /> {desktopActive ? "Desktop is running" : "Codex is working"}
                  </span>
                ) : (
                  <ModelReasoningPicker
                    models={models}
                    selectedModel={selectedModel}
                    reasoningEfforts={reasoningEfforts}
                    selectedReasoningEffort={selectedReasoningEffort}
                    disabled={models.length === 0 || reasoningEfforts.length === 0 || turnBusy}
                    onSelectedModelChange={onSelectedModelChange}
                    onSelectedReasoningEffortChange={onSelectedReasoningEffortChange}
                  />
                )}
                {turnBusy ? (
                  <button
                    className="composer-send-button stop"
                    type="button"
                    disabled={cancelling || !canStopTurn}
                    onClick={() => void handleCancel()}
                    title={canStopTurn ? "Stop" : "Desktop-owned turn cannot be stopped from Agent Port"}
                  >
                    <Square size={18} />
                  </button>
                ) : (
                  <button className="composer-send-button" type="submit" disabled={sendDisabled} title="Send">
                    <ArrowUp size={22} />
                  </button>
                )}
              </div>
            </div>
            {planMode ? (
              <div className="composer-plan-note">
                Managed plan-first mode for app-server. Codex will propose a plan and wait for confirmation before edits.
              </div>
            ) : null}
            {desktopActive ? (
              <div className="composer-plan-note">
                Codex Desktop is running this thread. Agent Port will refresh the transcript and unlock the composer when the thread is idle.
              </div>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}

function WaitingUserInputComposer({
  waitingInput,
  cancelling,
  onFileLinkClick,
  onSubmit,
  onStop
}: {
  waitingInput: WaitingUserInput | null;
  cancelling: boolean;
  onFileLinkClick: (link: MarkdownFileLink) => void;
  onSubmit: (text: string) => Promise<void>;
  onStop: () => void;
}) {
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesText, setChangesText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const confirmText = preferredConfirmAnswer(waitingInput);
  const questionText = waitingInput?.message || "Codex is waiting for confirmation.";

  useEffect(() => {
    setChangesOpen(false);
    setChangesText("");
  }, [waitingInput?.requested_at]);

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setChangesText("");
      setChangesOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitChanges(event: FormEvent) {
    event.preventDefault();
    await submit(changesText);
  }

  return (
    <div className="chat-composer waiting-user-input">
      <div className="waiting-input-card">
        <div className="waiting-input-header">
          <div>
            <span className="waiting-input-eyebrow">Waiting for user</span>
            <strong>Codex is waiting for confirmation</strong>
          </div>
          <button className="composer-send-button stop" type="button" disabled={cancelling} onClick={onStop} title="Stop">
            <Square size={18} />
          </button>
        </div>
        <div className="waiting-input-question">
          <MarkdownContent content={questionText} onFileLinkClick={onFileLinkClick} />
        </div>
        <div className="waiting-input-actions">
          <button
            className="icon-text-button primary"
            type="button"
            disabled={submitting}
            onClick={() => void submit(confirmText)}
          >
            <Check size={17} /> {submitting ? "Sending..." : "Confirm plan"}
          </button>
          <button
            className="icon-text-button secondary"
            type="button"
            disabled={submitting}
            aria-expanded={changesOpen}
            onClick={() => setChangesOpen((current) => !current)}
          >
            <MessageSquare size={17} /> Request changes
          </button>
        </div>
        {changesOpen ? (
          <form className="waiting-input-changes" onSubmit={handleSubmitChanges}>
            <textarea
              value={changesText}
              onChange={(event) => setChangesText(event.target.value)}
              placeholder="Tell Codex what to change before continuing..."
              rows={3}
            />
            <button className="icon-text-button attention" type="submit" disabled={submitting || !changesText.trim()}>
              <ArrowUp size={17} /> {submitting ? "Sending..." : "Send changes"}
            </button>
          </form>
        ) : null}
        <p className="waiting-input-context">
          This browser chat controls a separate local Codex CLI session. The confirmation is sent only to this session.
        </p>
      </div>
    </div>
  );
}

function PermissionModePicker({
  permissionModes,
  selectedPermissionMode,
  disabled,
  onSelectedPermissionModeChange
}: {
  permissionModes: PublicCodexPermissionMode[];
  selectedPermissionMode: CodexPermissionMode | "";
  disabled: boolean;
  onSelectedPermissionModeChange: (permissionMode: CodexPermissionMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const selectedMode =
    permissionModes.find((mode) => mode.id === selectedPermissionMode) ??
    permissionModes.find((mode) => mode.id === "default") ??
    permissionModes[0] ??
    null;

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const label = selectedMode ? formatCompactPermissionLabel(selectedMode.label) : "Permissions";
  const accessibleLabel = selectedMode ? `${selectedMode.label} permissions` : "Permissions";

  return (
    <div className="composer-picker-shell" ref={pickerRef}>
      <button
        className={selectedMode?.highRisk ? "composer-permission-trigger high-risk" : "composer-permission-trigger"}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={accessibleLabel}
        title={accessibleLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <PermissionModeIcon mode={selectedMode} size={18} />
        <span className="composer-permission-label">{label}</span>
        <ChevronDown size={17} />
      </button>
      {open ? (
        <div className="composer-picker-popover composer-permission-popover" role="menu">
          <div className="composer-picker-panel permission-panel">
            <div className="composer-picker-heading">Permissions</div>
            {permissionModes.map((mode) => {
              const selected = mode.id === selectedMode?.id;
              return (
                <button
                  className={selected ? "composer-picker-row descriptive selected" : "composer-picker-row descriptive"}
                  type="button"
                  key={mode.id}
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    onSelectedPermissionModeChange(mode.id);
                    setOpen(false);
                  }}
                >
                  <span className="composer-picker-row-copy">
                    <span>
                      {mode.label}
                      {mode.highRisk ? <strong className="composer-risk-chip">High risk</strong> : null}
                    </span>
                    <small>{mode.description}</small>
                  </span>
                  {selected ? <Check size={20} /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModelReasoningPicker({
  models,
  selectedModel,
  reasoningEfforts,
  selectedReasoningEffort,
  disabled,
  onSelectedModelChange,
  onSelectedReasoningEffortChange
}: {
  models: PublicCodexModel[];
  selectedModel: string;
  reasoningEfforts: PublicCodexReasoningEffort[];
  selectedReasoningEffort: CodexReasoningEffort | "";
  disabled: boolean;
  onSelectedModelChange: (model: string) => void;
  onSelectedReasoningEffortChange: (reasoningEffort: CodexReasoningEffort) => void;
}) {
  const [open, setOpen] = useState(false);
  const [modelPanelOpen, setModelPanelOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const selectedModelItem = models.find((model) => model.id === selectedModel) ?? models[0] ?? null;
  const selectedEffortItem =
    reasoningEfforts.find((effort) => effort.id === selectedReasoningEffort) ??
    reasoningEfforts.find((effort) => effort.id === "medium") ??
    reasoningEfforts[0] ??
    null;

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setModelPanelOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setModelPanelOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setModelPanelOpen(false);
    }
  }, [disabled]);

  const modelLabel = selectedModelItem?.label ?? "Codex";
  const effortLabel = selectedEffortItem?.label ?? "Medium";
  const shortEffortLabel = formatShortReasoningEffort(selectedEffortItem);

  return (
    <div className="composer-picker-shell" ref={pickerRef}>
      <button
        className="composer-model-trigger"
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${formatCompactModelLabel(modelLabel)} ${effortLabel}`}
        title={`${formatCompactModelLabel(modelLabel)} ${effortLabel}`}
        onClick={() => {
          setOpen((current) => !current);
          setModelPanelOpen(false);
        }}
      >
        <span className="composer-model-version">{formatCompactModelLabel(modelLabel)}</span>
        <span className="composer-model-effort">
          <span className="composer-model-effort-full">{effortLabel}</span>
          <span className="composer-model-effort-short" aria-hidden="true">
            {shortEffortLabel}
          </span>
        </span>
        <ChevronDown size={17} />
      </button>
      {open ? (
        <div className="composer-picker-popover" role="menu">
          <div className="composer-picker-panel">
            <div className="composer-picker-heading">Intelligence</div>
            {reasoningEfforts.map((effort) => {
              const selected = effort.id === selectedEffortItem?.id;
              return (
                <button
                  className={selected ? "composer-picker-row selected" : "composer-picker-row"}
                  type="button"
                  key={effort.id}
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    onSelectedReasoningEffortChange(effort.id);
                    setOpen(false);
                    setModelPanelOpen(false);
                  }}
                >
                  <span>{effort.label}</span>
                  {selected ? <Check size={20} /> : null}
                </button>
              );
            })}
            <div className="composer-picker-divider" />
            <div className="composer-picker-row-wrap">
              <button
                className={modelPanelOpen ? "composer-picker-row active" : "composer-picker-row"}
                type="button"
                role="menuitem"
                aria-expanded={modelPanelOpen}
                onClick={() => setModelPanelOpen((current) => !current)}
              >
                <span>{modelLabel}</span>
                <ChevronRight size={21} />
              </button>
              {modelPanelOpen ? (
                <div className="composer-picker-submenu" role="menu" aria-label="Model">
                  <div className="composer-picker-heading">Model</div>
                  {models.map((model) => {
                    const selected = model.id === selectedModelItem?.id;
                    return (
                      <button
                        className={selected ? "composer-picker-row selected" : "composer-picker-row"}
                        type="button"
                        key={model.id}
                        role="menuitemradio"
                        aria-checked={selected}
                        onClick={() => {
                          onSelectedModelChange(model.id);
                          setOpen(false);
                          setModelPanelOpen(false);
                        }}
                      >
                        <span>{model.label}</span>
                        {selected ? <Check size={20} /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PermissionModeIcon({ mode, size }: { mode: PublicCodexPermissionMode | null; size: number }) {
  if (mode?.id === "auto-review") {
    return <ShieldCheck size={size} />;
  }
  if (mode?.id === "full-access") {
    return <ShieldAlert size={size} />;
  }
  return <Shield size={size} />;
}

function AssistantActivityGroup({
  message,
  collapsed,
  onFileLinkClick,
  onToggle
}: {
  message: ChatMessage;
  collapsed: boolean;
  onFileLinkClick: (link: MarkdownFileLink) => void;
  onToggle: () => void;
}) {
  if (message.activities.length === 0) {
    return null;
  }
  const working = message.status === "streaming";
  return (
    <div className="assistant-activity">
      <button className="assistant-activity-toggle" type="button" onClick={onToggle}>
        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        <span>{working ? "Working..." : `Worked for ${formatDuration(message.duration_ms)}`}</span>
      </button>
      {!collapsed ? (
        <div className="assistant-activity-body">
          {message.activities.map((activity) => (
            <div className="assistant-activity-section" key={activity.id}>
              <div className="assistant-activity-title">{activity.title}</div>
              {activity.content ? (
                <MarkdownContent content={activity.content} onFileLinkClick={onFileLinkClick} />
              ) : (
                <p className="thinking-placeholder">Thinking...</p>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ComposerAttachmentTray({
  attachments,
  onRemove
}: {
  attachments: ComposerAttachment[];
  onRemove: (localId: string) => void;
}) {
  return (
    <div className="composer-attachment-tray" aria-label="Attached files">
      {attachments.map((item) => (
        <div className={`composer-attachment-chip ${item.status}`} key={item.localId}>
          <AttachmentIcon mimeType={item.file.type} fileName={item.file.name} size={16} />
          <span className="composer-attachment-text">
            <span className="composer-attachment-name">{item.file.name}</span>
            <span className="composer-attachment-meta" title={item.error ?? undefined}>
              {formatComposerAttachmentMeta(item)}
            </span>
          </span>
          {item.status === "pending" || item.status === "uploading" ? (
            <Loader2 className="composer-attachment-spinner" size={15} aria-hidden="true" />
          ) : null}
          {item.status === "error" ? <AlertCircle className="composer-attachment-alert" size={15} /> : null}
          <button
            className="composer-attachment-remove"
            type="button"
            aria-label={`Remove ${item.file.name}`}
            title="Remove"
            onClick={() => onRemove(item.localId)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function MessageAttachmentList({ message }: { message: ChatMessage }) {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) {
    return null;
  }
  return (
    <div className="message-attachments" aria-label="Message attachments">
      {attachments.map((attachment) => {
        const name = getAttachmentName(attachment);
        const mimeType = getAttachmentMimeType(attachment);
        const sizeLabel = formatBytes(getAttachmentSize(attachment));
        const url = chatAttachmentContentUrl(message.session_id, attachment.id);
        const meta = sizeLabel ? `${name} - ${sizeLabel}` : name;
        if (isImageAttachment(attachment)) {
          return (
            <a
              className="message-attachment-preview image"
              href={url}
              target="_blank"
              rel="noreferrer"
              key={attachment.id}
            >
              <img src={url} alt={name} loading="lazy" />
              <span className="message-attachment-caption">
                <FileImage size={14} /> {meta}
              </span>
            </a>
          );
        }
        if (isVideoAttachment(attachment)) {
          return (
            <div className="message-attachment-preview video" key={attachment.id}>
              <video src={url} controls preload="metadata" />
              <span className="message-attachment-caption">
                <FileVideo size={14} /> {meta}
              </span>
            </div>
          );
        }
        return (
          <a className="message-attachment-file" href={url} target="_blank" rel="noreferrer" key={attachment.id}>
            <AttachmentIcon mimeType={mimeType} fileName={name} size={16} />
            <span>
              <span className="message-attachment-name">{name}</span>
              {sizeLabel ? <span className="message-attachment-size">{sizeLabel}</span> : null}
            </span>
          </a>
        );
      })}
    </div>
  );
}

function AttachmentIcon({ mimeType, fileName, size }: { mimeType: string; fileName: string; size: number }) {
  if (isImageType(mimeType, fileName)) {
    return <FileImage size={size} />;
  }
  if (isVideoType(mimeType, fileName)) {
    return <FileVideo size={size} />;
  }
  return <FileIcon size={size} />;
}

function createLocalAttachmentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasDraggedFiles(event: DragEvent<HTMLFormElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function formatComposerAttachmentMeta(item: ComposerAttachment): string {
  if (item.status === "pending") {
    return "Queued";
  }
  if (item.status === "uploading") {
    return "Uploading";
  }
  if (item.status === "error") {
    return item.error ?? "Upload failed";
  }
  return formatBytes(item.file.size);
}

function getAttachmentName(attachment: ChatAttachment): string {
  return attachment.original_name || "Attachment";
}

function getAttachmentMimeType(attachment: ChatAttachment): string {
  return attachment.mime_type ?? "";
}

function getAttachmentSize(attachment: ChatAttachment): number | null {
  const size = attachment.size_bytes;
  return typeof size === "number" && Number.isFinite(size) ? size : null;
}

function isImageAttachment(attachment: ChatAttachment): boolean {
  return isImageType(getAttachmentMimeType(attachment), getAttachmentName(attachment));
}

function isVideoAttachment(attachment: ChatAttachment): boolean {
  return isVideoType(getAttachmentMimeType(attachment), getAttachmentName(attachment));
}

function isImageType(mimeType: string, fileName: string): boolean {
  if (mimeType.startsWith("image/")) {
    return true;
  }
  return /\.(avif|bmp|gif|heic|jpeg|jpg|png|webp)$/i.test(fileName);
}

function isVideoType(mimeType: string, fileName: string): boolean {
  if (mimeType.startsWith("video/")) {
    return true;
  }
  return /\.(m4v|mov|mp4|mpeg|webm)$/i.test(fileName);
}

function formatBytes(size: number | null): string {
  if (typeof size !== "number" || !Number.isFinite(size)) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatCompactModelLabel(label: string): string {
  return label.replace(/^GPT-/i, "");
}

function formatCompactPermissionLabel(label: string): string {
  return label.replace(/\s+permissions$/i, "");
}

function formatShortReasoningEffort(effort: PublicCodexReasoningEffort | null): string {
  if (effort?.id === "low") {
    return "L";
  }
  if (effort?.id === "medium") {
    return "M";
  }
  if (effort?.id === "high") {
    return "H";
  }
  if (effort?.id === "xhigh") {
    return "xH";
  }
  return effort?.label.slice(0, 1) ?? "M";
}

function preferredConfirmAnswer(waitingInput: WaitingUserInput | null): string {
  const options = waitingInput?.questions.flatMap((question) => question.options ?? []) ?? [];
  const match = options.find((option) => /confirm|approve|accept|proceed|continue|implement|yes|ok/i.test(option.label));
  return match?.label ?? "Confirm plan";
}

function fileLookupFromMarkdownLink(link: MarkdownFileLink): {
  label: string;
  query: { file?: string; name?: string };
} {
  const label = link.label.trim() || basenameFromLinkTarget(link.target) || "file";
  const target = decodeLinkTarget(link.target);
  if (target && !target.startsWith("/") && !/^https?:\/\//.test(target)) {
    const relativePath = target.replace(/^\.\//, "");
    return relativePath.includes("/") ? { label, query: { file: relativePath } } : { label, query: { name: relativePath } };
  }
  const labelPath = decodeLinkTarget(label).replace(/^\.\//, "");
  if (labelPath.includes("/") && !labelPath.startsWith("/") && !/^https?:\/\//.test(labelPath)) {
    return { label, query: { file: labelPath } };
  }
  const fileName = basenameFromLinkTarget(target) || basenameFromLinkTarget(label);
  return { label, query: { name: fileName || label } };
}

function decodeLinkTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function basenameFromLinkTarget(target: string): string {
  return target.split(/[\\/]+/).filter(Boolean).pop() ?? "";
}

function getVisibleAssistantContent(message: ChatMessage): string {
  const content = message.content.trim();
  if (!content) {
    return "";
  }
  if (
    message.status === "streaming" &&
    message.activities.some((activity) => activityContentContainsLeakedPrefix(activity.content, content))
  ) {
    return "";
  }
  return message.content;
}

function activityContentContainsLeakedPrefix(activityContent: string, content: string): boolean {
  const normalizedActivity = normalizeStreamingFragment(activityContent);
  const normalizedContent = normalizeStreamingFragment(content);
  return Boolean(normalizedContent) && normalizedActivity.startsWith(normalizedContent);
}

function normalizeStreamingFragment(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs < 1000) {
    return "<1s";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  if (minutes < 60) {
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
