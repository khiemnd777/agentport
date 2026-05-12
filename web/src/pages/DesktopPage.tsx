import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell, { type MobileTab } from "../components/layout/AppShell";
import ChatWorkspace from "../components/chat/ChatWorkspace";
import InspectorPanel, { type InspectorTab } from "../components/layout/InspectorPanel";
import Sidebar from "../components/layout/Sidebar";
import TopBar from "../components/layout/TopBar";
import CodexTerminal from "../components/terminal/CodexTerminal";
import GitStatusPanel from "../components/git/GitStatusPanel";
import NotificationControl from "../components/notifications/NotificationControl";
import {
  apiFetch,
  chatSocketUrl,
  type ChatMessage,
  type ChatSocketEvent,
  type CodexSession,
  type CodexPermissionMode,
  type CodexReasoningEffort,
  type GitStatus,
  type PublicCodexModel,
  type PublicCodexPermissionMode,
  type PublicCodexReasoningEffort,
  type PublicRepo,
  type TaskStatus,
  type TerminalStatus
} from "../api/client";
import { getRepos } from "../api/reposApi";
import { archiveSession, closeSession, createSession, deleteSession, listSessions } from "../api/sessionsApi";
import { getGitDiff, getGitStatus } from "../api/gitApi";
import { interruptChat, listChatMessages, listCodexModels, sendChatMessage } from "../api/chatApi";
import type { DisplayMode } from "../theme";

interface Props {
  displayMode: DisplayMode;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onLogout: () => Promise<void>;
}

const CODEX_MODEL_STORAGE_KEY = "remote-codex-model";
const CODEX_REASONING_EFFORT_STORAGE_KEY = "remote-codex-reasoning-effort";
const CODEX_PERMISSION_MODE_STORAGE_KEY = "remote-codex-permission-mode";
const ACTIVE_SESSION_STORAGE_KEY = "agent-port-active-session-id";

export default function DesktopPage({ displayMode, onDisplayModeChange, onLogout }: Props) {
  const [repos, setRepos] = useState<PublicRepo[]>([]);
  const [codexModels, setCodexModels] = useState<PublicCodexModel[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [codexReasoningEfforts, setCodexReasoningEfforts] = useState<PublicCodexReasoningEffort[]>([]);
  const [defaultReasoningEffort, setDefaultReasoningEffort] = useState<CodexReasoningEffort | "">("");
  const [codexPermissionModes, setCodexPermissionModes] = useState<PublicCodexPermissionMode[]>([]);
  const [defaultPermissionMode, setDefaultPermissionMode] = useState<CodexPermissionMode | "">("");
  const [selectedModel, setSelectedModel] = useState(() => window.localStorage.getItem(CODEX_MODEL_STORAGE_KEY) ?? "");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<CodexReasoningEffort | "">(
    () => normalizeStoredReasoningEffort(window.localStorage.getItem(CODEX_REASONING_EFFORT_STORAGE_KEY))
  );
  const [selectedPermissionMode, setSelectedPermissionMode] = useState<CodexPermissionMode | "">(
    () => normalizeStoredPermissionMode(window.localStorage.getItem(CODEX_PERMISSION_MODE_STORAGE_KEY))
  );
  const [selectedRepoKey, setSelectedRepoKey] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CodexSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    () => window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [gitRefreshing, setGitRefreshing] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("console");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("console");
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.key === selectedRepoKey) ?? null,
    [repos, selectedRepoKey]
  );
  const sessionsForRepo = useMemo(
    () => sessions.filter((session) => !selectedRepoKey || session.repo_key === selectedRepoKey),
    [sessions, selectedRepoKey]
  );
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );

  const refreshSessions = useCallback(async () => {
    const result = await listSessions({ includeArchived: showHistory });
    setSessions(result.sessions);
    setActiveSessionId((current) =>
      current && result.sessions.some((session) => session.id === current)
        ? current
        : result.sessions[0]?.id ?? null
    );
  }, [showHistory]);

  const refreshMessages = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      setChatMessages([]);
      return;
    }
    const result = await listChatMessages(sessionId);
    setChatMessages((current) => upsertMessages(current.filter((message) => message.session_id === sessionId), result.messages));
  }, []);

  const refreshGit = useCallback(
    async (sessionId: string | null = activeSessionId, file: string | null = selectedFile) => {
      if (!sessionId) {
        setGitStatus(null);
        setDiff("");
        return;
      }
      setGitRefreshing(true);
      try {
        const [statusResult, diffResult] = await Promise.all([
          getGitStatus(sessionId),
          getGitDiff(sessionId, file ?? undefined)
        ]);
        setGitStatus(statusResult.status);
        setDiff(diffResult.diff);
      } finally {
        setGitRefreshing(false);
      }
    },
    [activeSessionId, selectedFile]
  );

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await refreshSessions();
      await refreshMessages(activeSessionId);
      await refreshGit(activeSessionId, selectedFile);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [activeSessionId, refreshGit, refreshMessages, refreshSessions, selectedFile]);

  useEffect(() => {
    async function bootstrap() {
      setRefreshing(true);
      try {
        const [repoResult, sessionResult] = await Promise.all([
          getRepos(),
          listSessions({ includeArchived: false })
        ]);
        const storedActiveSessionId = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
        const storedActiveSession = sessionResult.sessions.find((session) => session.id === storedActiveSessionId);
        setRepos(repoResult.repos);
        setSelectedRepoKey(storedActiveSession?.repo_key ?? repoResult.defaultRepo);
        setSessions(sessionResult.sessions);
        setActiveSessionId(storedActiveSession?.id ?? sessionResult.sessions[0]?.id ?? null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setRefreshing(false);
      }
    }
    void bootstrap();
  }, []);

  useEffect(() => {
    if (activeSessionId) {
      window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
      return;
    }
    window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  }, [activeSessionId]);

  useEffect(() => {
    async function loadModels() {
      try {
        const result = await listCodexModels();
        setCodexModels(result.models);
        setDefaultModel(result.defaultModel);
        setCodexReasoningEfforts(result.reasoningEfforts);
        setDefaultReasoningEffort(result.defaultReasoningEffort);
        setCodexPermissionModes(result.permissionModes);
        setDefaultPermissionMode(result.defaultPermissionMode);
        setSelectedModel((current) => {
          const next = normalizeSelectedModel(current, result.models, result.defaultModel);
          window.localStorage.setItem(CODEX_MODEL_STORAGE_KEY, next);
          return next;
        });
        setSelectedReasoningEffort((current) => {
          const next = normalizeSelectedReasoningEffort(
            current,
            result.reasoningEfforts,
            result.defaultReasoningEffort
          );
          window.localStorage.setItem(CODEX_REASONING_EFFORT_STORAGE_KEY, next);
          return next;
        });
        setSelectedPermissionMode((current) => {
          const next = normalizeSelectedPermissionMode(current, result.permissionModes, result.defaultPermissionMode);
          window.localStorage.setItem(CODEX_PERMISSION_MODE_STORAGE_KEY, next);
          return next;
        });
      } catch (err) {
        setError((err as Error).message);
      }
    }
    void loadModels();
  }, []);

  useEffect(() => {
    void refreshMessages(activeSessionId);
    void refreshGit(activeSessionId, selectedFile);
  }, [activeSessionId, refreshGit, refreshMessages, selectedFile]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshSessions();
      void refreshMessages(activeSessionId);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [activeSessionId, refreshMessages, refreshSessions]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    let disposed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let currentSocket: WebSocket | null = null;
    const reconnectDelaysMs = [1000, 2000, 5000, 10000];

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const connect = () => {
      if (disposed) {
        return;
      }
      clearReconnectTimer();
      const socket = new WebSocket(chatSocketUrl(activeSessionId));
      currentSocket = socket;
      socket.addEventListener("open", () => {
        reconnectAttempt = 0;
      });
      socket.addEventListener("message", (event) => {
        let payload: ChatSocketEvent;
        try {
          payload = JSON.parse(event.data) as ChatSocketEvent;
        } catch {
          return;
        }
        if (payload.sessionId !== activeSessionId) {
          return;
        }
        if (payload.type === "message_created" || payload.type === "message_updated") {
          setChatMessages((current) => upsertMessages(current, [payload.message]));
          return;
        }
        if (payload.type === "message_delta") {
          setChatMessages((current) => appendMessageDelta(current, payload.messageId, payload.delta));
          return;
        }
        if (payload.type === "session_status") {
          setSessions((current) => upsertSessions(current, [payload.session]));
          return;
        }
        if (payload.type === "error") {
          setError(payload.message);
        }
      });
      socket.addEventListener("error", () => {
        void refreshMessages(activeSessionId);
      });
      socket.addEventListener("close", () => {
        if (disposed) {
          return;
        }
        if (currentSocket === socket) {
          currentSocket = null;
        }
        const delayMs = reconnectDelaysMs[Math.min(reconnectAttempt, reconnectDelaysMs.length - 1)];
        reconnectAttempt += 1;
        reconnectTimer = window.setTimeout(connect, delayMs);
      });
    };

    connect();
    return () => {
      disposed = true;
      clearReconnectTimer();
      currentSocket?.close();
      currentSocket = null;
    };
  }, [activeSessionId, refreshMessages]);

  const handleTerminalStatus = useCallback(
    (status: { terminalStatus: TerminalStatus; taskStatus: TaskStatus }) => {
      if (!activeSessionId) {
        return;
      }
      setSessions((current) =>
        current.map((session) =>
          session.id === activeSessionId
            ? { ...session, terminal_status: status.terminalStatus, task_status: status.taskStatus }
            : session
        )
      );
    },
    [activeSessionId]
  );

  async function handleCreateSession() {
    if (!selectedRepoKey) {
      return;
    }
    setError(null);
    try {
      const result = await createSession({
        repo_key: selectedRepoKey,
        title: `${selectedRepo?.label ?? selectedRepoKey} remote session`
      });
      await refreshSessions();
      setActiveSessionId(result.session.id);
      setMobileTab("chat");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCloseSession() {
    if (!activeSession) {
      return;
    }
    await closeSession(activeSession.id);
    await refreshSessions();
  }

  async function handleArchiveSession(sessionId: string) {
    setError(null);
    try {
      await archiveSession(sessionId);
      await refreshSessions();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    const confirmed = window.confirm(
      `Delete "${session?.title ?? "this session"}" and its local logs/events? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    setError(null);
    try {
      await deleteSession(sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
      }
      await refreshSessions();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleToggleHistory(nextShowHistory: boolean) {
    setShowHistory(nextShowHistory);
    setRefreshing(true);
    setError(null);
    try {
      const result = await listSessions({ includeArchived: nextShowHistory });
      setSessions(result.sessions);
      setActiveSessionId((current) =>
        current && result.sessions.some((session) => session.id === current)
          ? current
          : result.sessions[0]?.id ?? null
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSendChatMessage(prompt: string, attachmentIds: string[]) {
    if (!activeSession) {
      return;
    }
    const model = normalizeSelectedModel(selectedModel, codexModels, defaultModel);
    const reasoningEffort = normalizeSelectedReasoningEffort(
      selectedReasoningEffort,
      codexReasoningEfforts,
      defaultReasoningEffort
    );
    const permissionMode = normalizeSelectedPermissionMode(
      selectedPermissionMode,
      codexPermissionModes,
      defaultPermissionMode
    );
    const result = await sendChatMessage(activeSession.id, prompt, model, reasoningEffort, permissionMode, attachmentIds);
    setChatMessages((current) => upsertMessages(current, result.messages));
    await refreshSessions();
  }

  function handleSelectedModelChange(model: string) {
    const next = normalizeSelectedModel(model, codexModels, defaultModel);
    setSelectedModel(next);
    window.localStorage.setItem(CODEX_MODEL_STORAGE_KEY, next);
  }

  function handleSelectedReasoningEffortChange(reasoningEffort: CodexReasoningEffort) {
    const next = normalizeSelectedReasoningEffort(reasoningEffort, codexReasoningEfforts, defaultReasoningEffort);
    setSelectedReasoningEffort(next);
    window.localStorage.setItem(CODEX_REASONING_EFFORT_STORAGE_KEY, next);
  }

  function handleSelectedPermissionModeChange(permissionMode: CodexPermissionMode) {
    const next = normalizeSelectedPermissionMode(permissionMode, codexPermissionModes, defaultPermissionMode);
    setSelectedPermissionMode(next);
    window.localStorage.setItem(CODEX_PERMISSION_MODE_STORAGE_KEY, next);
  }

  async function handleStopChatTurn() {
    if (!activeSession) {
      return;
    }
    await interruptChat(activeSession.id);
    await refreshSessions();
    await refreshMessages(activeSession.id);
  }

  async function handleLogout() {
    await apiFetch("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({})
    });
    await onLogout();
  }

  async function handleSelectFile(file: string | null) {
    setSelectedFile(file);
    await refreshGit(activeSessionId, file);
  }

  const chatTurnBusy = ["CREATED", "RUNNING", "WAITING_FOR_USER"].includes(activeSession?.task_status ?? "IDLE");

  const consolePanel = <CodexTerminal sessionId={activeSessionId} onStatus={handleTerminalStatus} />;
  const changesPanel = (
    <GitStatusPanel
      status={gitStatus}
      diff={diff}
      selectedFile={selectedFile}
      refreshing={gitRefreshing}
      onRefresh={() => void refreshGit()}
      onSelectFile={handleSelectFile}
    />
  );
  const chatPanel = (
    <ChatWorkspace
      activeSession={activeSession}
      selectedRepo={selectedRepo}
      messages={chatMessages}
      turnBusy={chatTurnBusy}
      models={codexModels}
      selectedModel={normalizeSelectedModel(selectedModel, codexModels, defaultModel)}
      reasoningEfforts={codexReasoningEfforts}
      selectedReasoningEffort={normalizeSelectedReasoningEffort(
        selectedReasoningEffort,
        codexReasoningEfforts,
        defaultReasoningEffort
      )}
      permissionModes={codexPermissionModes}
      selectedPermissionMode={normalizeSelectedPermissionMode(
        selectedPermissionMode,
        codexPermissionModes,
        defaultPermissionMode
      )}
      onSelectedModelChange={handleSelectedModelChange}
      onSelectedReasoningEffortChange={handleSelectedReasoningEffortChange}
      onSelectedPermissionModeChange={handleSelectedPermissionModeChange}
      onSubmitMessage={handleSendChatMessage}
      onStopTurn={handleStopChatTurn}
      onCreateSession={() => void handleCreateSession()}
      onOpenConsole={() => {
        setInspectorTab("console");
        setMobileTab("console");
      }}
    />
  );
  const inspectorPanel = (
    <InspectorPanel
      activeTab={inspectorTab}
      consolePanel={consolePanel}
      changesPanel={changesPanel}
      onTabChange={setInspectorTab}
    />
  );

  return (
    <>
      {error ? <div className="toast-error">{error}</div> : null}
      <AppShell
        topBar={
          <TopBar
            activeSession={activeSession}
            selectedRepo={selectedRepo}
            refreshing={refreshing}
            displayMode={displayMode}
            onRefresh={() => void refreshAll()}
            onCloseSession={() => void handleCloseSession()}
            onDisplayModeChange={onDisplayModeChange}
            onLogout={() => void handleLogout()}
            notificationControl={<NotificationControl onError={setError} />}
          />
        }
        sidebar={
          <Sidebar
            repos={repos}
            selectedRepoKey={selectedRepoKey}
            sessions={sessionsForRepo}
            activeSessionId={activeSessionId}
            showHistory={showHistory}
            onSelectRepo={setSelectedRepoKey}
            onSelectSession={(sessionId) => {
              setActiveSessionId(sessionId);
              setMobileTab("chat");
            }}
            onCreateSession={() => void handleCreateSession()}
            onToggleHistory={(nextShowHistory) => void handleToggleHistory(nextShowHistory)}
            onArchiveSession={(sessionId) => void handleArchiveSession(sessionId)}
            onDeleteSession={(sessionId) => void handleDeleteSession(sessionId)}
          />
        }
        chat={chatPanel}
        console={consolePanel}
        changes={changesPanel}
        inspector={inspectorPanel}
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
      />
    </>
  );
}

function upsertMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function appendMessageDelta(current: ChatMessage[], messageId: string, delta: string): ChatMessage[] {
  const now = new Date().toISOString();
  return current.map((message) =>
    message.id === messageId
      ? { ...message, content: `${message.content}${delta}`, status: "streaming", updated_at: now }
      : message
  );
}

function upsertSessions(current: CodexSession[], incoming: CodexSession[]): CodexSession[] {
  const byId = new Map(current.map((session) => [session.id, session]));
  for (const session of incoming) {
    byId.set(session.id, session);
  }
  return [...byId.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

function normalizeSelectedModel(modelsValue: string, models: PublicCodexModel[], defaultModel: string): string {
  if (models.some((model) => model.id === modelsValue)) {
    return modelsValue;
  }
  if (models.some((model) => model.id === defaultModel)) {
    return defaultModel;
  }
  return models[0]?.id ?? "";
}

function normalizeSelectedReasoningEffort(
  effortValue: CodexReasoningEffort | "",
  efforts: PublicCodexReasoningEffort[],
  defaultReasoningEffort: CodexReasoningEffort | ""
): CodexReasoningEffort | "" {
  if (efforts.some((effort) => effort.id === effortValue)) {
    return effortValue;
  }
  if (defaultReasoningEffort && efforts.some((effort) => effort.id === defaultReasoningEffort)) {
    return defaultReasoningEffort;
  }
  return efforts.find((effort) => effort.id === "medium")?.id ?? efforts[0]?.id ?? "";
}

function normalizeSelectedPermissionMode(
  permissionValue: CodexPermissionMode | "",
  modes: PublicCodexPermissionMode[],
  defaultPermissionMode: CodexPermissionMode | ""
): CodexPermissionMode | "" {
  if (modes.some((mode) => mode.id === permissionValue)) {
    return permissionValue;
  }
  if (defaultPermissionMode && modes.some((mode) => mode.id === defaultPermissionMode)) {
    return defaultPermissionMode;
  }
  return modes.find((mode) => mode.id === "default")?.id ?? modes[0]?.id ?? "";
}

function normalizeStoredReasoningEffort(value: string | null): CodexReasoningEffort | "" {
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }
  return "";
}

function normalizeStoredPermissionMode(value: string | null): CodexPermissionMode | "" {
  if (value === "default" || value === "auto-review" || value === "full-access") {
    return value;
  }
  return "";
}
