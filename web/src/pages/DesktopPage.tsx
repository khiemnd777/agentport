import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell, { type MobileTab } from "../components/layout/AppShell";
import ChatWorkspace from "../components/chat/ChatWorkspace";
import InspectorPanel, { type InspectorTab } from "../components/layout/InspectorPanel";
import Sidebar, { type SessionSidebarView } from "../components/layout/Sidebar";
import TopBar from "../components/layout/TopBar";
import CodexTerminal from "../components/terminal/CodexTerminal";
import GitStatusPanel from "../components/git/GitStatusPanel";
import NotificationControl from "../components/notifications/NotificationControl";
import RepoSettingsPanel from "../components/repos/RepoSettingsPanel";
import {
  apiFetch,
  chatSocketUrl,
  type ChatMessage,
  type ChatSocketEvent,
  type CodexHistoryThread,
  type CodexSession,
  type CodexPermissionMode,
  type CodexReasoningEffort,
  type GitStatus,
  type PublicCodexModel,
  type PublicCodexPermissionMode,
  type PublicCodexReasoningEffort,
  type PublicRepo,
  type RepoDiscoveryStatus,
  type TaskStatus,
  type TerminalStatus
} from "../api/client";
import {
  addRepo as addRepoRequest,
  getRepos,
  removeRepo as removeRepoRequest,
  requestServerRestart,
  resolveRepoFolder,
  setDefaultRepo as setDefaultRepoRequest
} from "../api/reposApi";
import {
  archiveSession,
  closeSession,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  updateSessionRunProfile
} from "../api/sessionsApi";
import { getGitDiff, getGitStatus } from "../api/gitApi";
import {
  interruptChat,
  listChatMessages,
  listCodexHistory,
  listCodexModels,
  openCodexHistoryThread,
  sendChatMessage,
  submitChatUserInput
} from "../api/chatApi";
import type { DisplayMode } from "../theme";

interface Props {
  displayMode: DisplayMode;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onLogout: () => Promise<void>;
}

const CODEX_MODEL_STORAGE_KEY = "remote-codex-model";
const CODEX_REASONING_EFFORT_STORAGE_KEY = "remote-codex-reasoning-effort";
const CODEX_PERMISSION_MODE_STORAGE_KEY = "remote-codex-permission-mode";
const CODEX_PLAN_MODE_STORAGE_KEY = "remote-codex-plan-mode";
const ACTIVE_SESSION_STORAGE_KEY = "agent-port-active-session-id";
const SESSION_PAGE_LIMIT = 30;

interface SessionViewPaging {
  nextCursor: string | null;
  hasMore: boolean;
  loaded: boolean;
  loadingMore: boolean;
}

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
  const [planMode, setPlanMode] = useState(() => window.localStorage.getItem(CODEX_PLAN_MODE_STORAGE_KEY) === "true");
  const [selectedRepoKey, setSelectedRepoKey] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CodexSession[]>([]);
  const [codexHistoryThreads, setCodexHistoryThreads] = useState<CodexHistoryThread[]>([]);
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
  const [sessionView, setSessionView] = useState<SessionSidebarView>("active");
  const [sessionViewPaging, setSessionViewPaging] = useState<Record<SessionSidebarView, SessionViewPaging>>(
    createInitialSessionViewPaging
  );
  const [selectedArchiveSessionIds, setSelectedArchiveSessionIds] = useState<Set<string>>(() => new Set());
  const [defaultRepoKey, setDefaultRepoKey] = useState("");
  const [repoDiscovery, setRepoDiscovery] = useState<RepoDiscoveryStatus | null>(null);
  const [repoSettingsOpen, setRepoSettingsOpen] = useState(false);
  const isMobileLayout = useMediaQuery("(max-width: 940px)");

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.key === selectedRepoKey) ?? null,
    [repos, selectedRepoKey]
  );
  const sessionsForRepo = useMemo(
    () =>
      sessions.filter((session) => {
        if (selectedRepoKey && session.repo_key !== selectedRepoKey) {
          return false;
        }
        if (sessionView === "archive") {
          return Boolean(session.archived_at);
        }
        return !session.archived_at;
      }),
    [sessions, selectedRepoKey, sessionView]
  );
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );
  const selectedVisibleArchiveSessionIds = useMemo(
    () => sessionsForRepo.filter((session) => selectedArchiveSessionIds.has(session.id)).map((session) => session.id),
    [sessionsForRepo, selectedArchiveSessionIds]
  );

  const refreshRepos = useCallback(async () => {
    const result = await getRepos();
    setRepos(result.repos);
    setDefaultRepoKey(result.defaultRepo);
    setRepoDiscovery(result.repoDiscovery);
    setSelectedRepoKey((current) =>
      current && result.repos.some((repo) => repo.key === current)
        ? current
        : result.defaultRepo || (result.repos[0]?.key ?? null)
    );
  }, []);

  const loadSessionViewPage = useCallback(
    async (
      view: SessionSidebarView,
      options: { cursor?: string | null; replace?: boolean } = {}
    ) => {
      const cursor = options.cursor ?? null;
      if (view === "history") {
        const result = await listCodexHistory(selectedRepoKey, { limit: SESSION_PAGE_LIMIT, cursor });
        setCodexHistoryThreads((current) =>
          options.replace ? result.threads : upsertCodexHistoryThreads(current, result.threads)
        );
        setSessionViewPaging((current) => ({
          ...current,
          history: mergeSessionViewPaging(current.history, result, !cursor && !options.replace)
        }));
        return result.threads;
      }

      const result = await listSessions({
        view: view === "archive" ? "archived" : "active",
        limit: SESSION_PAGE_LIMIT,
        cursor
      });
      setSessions((current) =>
        options.replace
          ? replaceSessionsForView(current, view, result.sessions)
          : upsertSessions(current, result.sessions)
      );
      setSessionViewPaging((current) => ({
        ...current,
        [view]: mergeSessionViewPaging(current[view], result, !cursor && !options.replace)
      }));
      if (view === "active") {
        setActiveSessionId((current) => current ?? result.sessions[0]?.id ?? null);
      }
      return result.sessions;
    },
    [selectedRepoKey]
  );

  const refreshSessions = useCallback(async () => {
    await loadSessionViewPage(sessionView);
  }, [loadSessionViewPage, sessionView]);

  const refreshMessages = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      setChatMessages([]);
      return;
    }
    const result = await listChatMessages(sessionId);
    setChatMessages(result.messages);
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
      await refreshRepos();
      await refreshSessions();
      await refreshMessages(activeSessionId);
      await refreshGit(activeSessionId, selectedFile);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [activeSessionId, refreshGit, refreshMessages, refreshRepos, refreshSessions, selectedFile]);

  useEffect(() => {
    async function bootstrap() {
      setRefreshing(true);
      try {
        const [repoResult, sessionResult] = await Promise.all([
          getRepos(),
          listSessions({ view: "active", limit: SESSION_PAGE_LIMIT })
        ]);
        const storedActiveSessionId = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
        let initialSessions = sessionResult.sessions;
        let storedActiveSession = initialSessions.find((session) => session.id === storedActiveSessionId);
        if (storedActiveSessionId && !storedActiveSession) {
          storedActiveSession = await getSession(storedActiveSessionId)
            .then((result) => (result.session.archived_at ? undefined : result.session))
            .catch(() => undefined);
          if (storedActiveSession) {
            initialSessions = upsertSessions(initialSessions, [storedActiveSession]);
          }
        }
        setRepos(repoResult.repos);
        setDefaultRepoKey(repoResult.defaultRepo);
        setRepoDiscovery(repoResult.repoDiscovery);
        setSelectedRepoKey(storedActiveSession?.repo_key ?? repoResult.defaultRepo);
        setSessions(initialSessions);
        setSessionViewPaging((current) => ({
          ...current,
          active: {
            ...current.active,
            loaded: true,
            hasMore: sessionResult.has_more,
            nextCursor: sessionResult.next_cursor
          }
        }));
        setActiveSessionId(storedActiveSession?.id ?? initialSessions[0]?.id ?? null);
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
    if (sessionView !== "archive") {
      setSelectedArchiveSessionIds((current) => (current.size === 0 ? current : new Set()));
      return;
    }
    const visibleIds = new Set(sessionsForRepo.map((session) => session.id));
    setSelectedArchiveSessionIds((current) => {
      const next = new Set([...current].filter((sessionId) => visibleIds.has(sessionId)));
      return next.size === current.size ? current : next;
    });
  }, [sessionView, sessionsForRepo]);

  useEffect(() => {
    if (sessionView === "history") {
      setCodexHistoryThreads([]);
      setSessionViewPaging((current) => ({
        ...current,
        history: createEmptySessionViewPaging()
      }));
      void loadSessionViewPage("history", { replace: true }).catch((err) => setError((err as Error).message));
    }
  }, [loadSessionViewPage, sessionView, selectedRepoKey]);

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
    const profile = activeSession?.run_profile;
    if (!profile) {
      return;
    }
    setSelectedModel((current) => {
      const next = normalizeSelectedModel(profile.model, codexModels, defaultModel);
      return current === next ? current : next;
    });
    setSelectedReasoningEffort((current) => {
      const next = normalizeSelectedReasoningEffort(profile.reasoning_effort, codexReasoningEfforts, defaultReasoningEffort);
      return current === next ? current : next;
    });
    setSelectedPermissionMode((current) => {
      const next = normalizeSelectedPermissionMode(profile.permission_mode, codexPermissionModes, defaultPermissionMode);
      return current === next ? current : next;
    });
    setPlanMode(profile.plan_mode);
  }, [
    activeSession?.id,
    activeSession?.run_profile?.updated_at,
    codexModels,
    codexPermissionModes,
    codexReasoningEfforts,
    defaultModel,
    defaultPermissionMode,
    defaultReasoningEffort
  ]);

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
      setSessionView("active");
      const activeResult = await listSessions({ view: "active", limit: SESSION_PAGE_LIMIT });
      setSessions((current) => upsertSessions(current, activeResult.sessions));
      setSessionViewPaging((current) => ({
        ...current,
        active: {
          ...current.active,
          loaded: true,
          hasMore: activeResult.has_more,
          nextCursor: activeResult.next_cursor
        }
      }));
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
      const result = await archiveSession(sessionId);
      setSessions((current) => upsertSessions(current, [result.session]));
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
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      setSelectedArchiveSessionIds((current) => {
        if (!current.has(sessionId)) {
          return current;
        }
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
      }
      await refreshSessions();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleSessionViewChange(nextView: SessionSidebarView) {
    setSessionView(nextView);
    setSelectedArchiveSessionIds(new Set());
    setError(null);
    if (nextView === "history" || sessionViewPaging[nextView].loaded) {
      return;
    }
    setRefreshing(true);
    try {
      await loadSessionViewPage(nextView);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleLoadMoreSessions() {
    const view = sessionView;
    const paging = sessionViewPaging[view];
    if (refreshing || paging.loadingMore || !paging.hasMore || !paging.nextCursor) {
      return;
    }
    setSessionViewPaging((current) => ({
      ...current,
      [view]: {
        ...current[view],
        loadingMore: true
      }
    }));
    setError(null);
    try {
      await loadSessionViewPage(view, { cursor: paging.nextCursor });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSessionViewPaging((current) => ({
        ...current,
        [view]: {
          ...current[view],
          loadingMore: false
        }
      }));
    }
  }

  function handleToggleArchiveSessionSelection(sessionId: string, selected: boolean) {
    setSelectedArchiveSessionIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }
      return next;
    });
  }

  function handleToggleAllArchiveSessions(selected: boolean) {
    setSelectedArchiveSessionIds(selected ? new Set(sessionsForRepo.map((session) => session.id)) : new Set());
  }

  async function handleDeleteSelectedArchiveSessions() {
    if (selectedVisibleArchiveSessionIds.length === 0) {
      return;
    }
    const confirmed = window.confirm(
      `Delete ${selectedVisibleArchiveSessionIds.length} archived sessions?\n\nThis removes Agent Port local session metadata, logs, events, and cached messages.\nSynced Codex Desktop threads are forgotten locally, not deleted from Codex Desktop.`
    );
    if (!confirmed) {
      return;
    }
    setError(null);
    const results = await Promise.allSettled(
      selectedVisibleArchiveSessionIds.map(async (sessionId) => {
        await deleteSession(sessionId);
        return sessionId;
      })
    );
    const deletedIds = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    const failedCount = results.length - deletedIds.length;
    const deletedIdSet = new Set(deletedIds);
    setSessions((current) => current.filter((session) => !deletedIdSet.has(session.id)));
    setSelectedArchiveSessionIds((current) => new Set([...current].filter((sessionId) => !deletedIdSet.has(sessionId))));
    if (activeSessionId && deletedIdSet.has(activeSessionId)) {
      setActiveSessionId(null);
    }
    await refreshSessions();
    if (failedCount > 0) {
      setError(`${failedCount} archived sessions could not be deleted.`);
    }
  }

  async function handleOpenCodexHistoryThread(thread: CodexHistoryThread) {
    setRefreshing(true);
    setError(null);
    try {
      const result = await openCodexHistoryThread(thread.id, thread.repo_key);
      setSelectedRepoKey(thread.repo_key);
      setSessionView("active");
      setSessions((current) => upsertSessions(current, [result.session]));
      setCodexHistoryThreads((current) =>
        current.filter((item) => item.id !== thread.id || item.repo_key !== thread.repo_key)
      );
      setActiveSessionId(result.session.id);
      setMobileTab("chat");
      await refreshMessages(result.session.id);
      const activeResult = await listSessions({ view: "active", limit: SESSION_PAGE_LIMIT });
      setSessions((current) => upsertSessions(current, activeResult.sessions));
      setSessionViewPaging((current) => ({
        ...current,
        active: {
          ...current.active,
          loaded: true,
          hasMore: activeResult.has_more,
          nextCursor: activeResult.next_cursor
        }
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  const composerModel = normalizeSelectedModel(activeSession?.run_profile?.model ?? selectedModel, codexModels, defaultModel);
  const composerReasoningEffort = normalizeSelectedReasoningEffort(
    activeSession?.run_profile?.reasoning_effort ?? selectedReasoningEffort,
    codexReasoningEfforts,
    defaultReasoningEffort
  );
  const composerPermissionMode = normalizeSelectedPermissionMode(
    activeSession?.run_profile?.permission_mode ?? selectedPermissionMode,
    codexPermissionModes,
    defaultPermissionMode
  );
  const composerPlanMode = activeSession?.run_profile?.plan_mode ?? planMode;

  async function handleSendChatMessage(prompt: string, attachmentIds: string[]) {
    if (!activeSession) {
      return;
    }
    const result = await sendChatMessage(
      activeSession.id,
      prompt,
      composerModel,
      composerReasoningEffort,
      composerPermissionMode,
      attachmentIds,
      composerPlanMode
    );
    setChatMessages((current) => upsertMessages(current, result.messages));
    await refreshSessions();
  }

  async function handleSubmitChatUserInput(text: string) {
    if (!activeSession) {
      return;
    }
    const result = await submitChatUserInput(activeSession.id, text);
    setChatMessages((current) => upsertMessages(current, result.messages));
    await refreshSessions();
  }

  async function persistRunProfile(input: {
    model?: string;
    reasoning_effort?: CodexReasoningEffort;
    permission_mode?: CodexPermissionMode;
    plan_mode?: boolean;
  }) {
    if (!activeSession || !composerReasoningEffort || !composerPermissionMode) {
      return;
    }
    setError(null);
    try {
      const result = await updateSessionRunProfile(activeSession.id, input);
      setSessions((current) => upsertSessions(current, [result.session]));
    } catch (err) {
      setError((err as Error).message);
      void refreshSessions();
    }
  }

  function applyRunProfileLocally(input: {
    model?: string;
    reasoning_effort?: CodexReasoningEffort;
    permission_mode?: CodexPermissionMode;
    plan_mode?: boolean;
  }) {
    if (!activeSession || !composerReasoningEffort || !composerPermissionMode) {
      return;
    }
    const reasoningEffort = composerReasoningEffort;
    const permissionMode = composerPermissionMode;
    setSessions((current) =>
      upsertSessions(current, [
        {
          ...activeSession,
          run_profile: {
            model: input.model ?? composerModel,
            reasoning_effort: input.reasoning_effort ?? reasoningEffort,
            permission_mode: input.permission_mode ?? permissionMode,
            plan_mode: input.plan_mode ?? composerPlanMode,
            updated_at: new Date().toISOString()
          }
        }
      ])
    );
  }

  function handleSelectedModelChange(model: string) {
    const next = normalizeSelectedModel(model, codexModels, defaultModel);
    setSelectedModel(next);
    if (activeSession) {
      applyRunProfileLocally({ model: next });
      void persistRunProfile({ model: next });
    } else {
      window.localStorage.setItem(CODEX_MODEL_STORAGE_KEY, next);
    }
  }

  function handleSelectedReasoningEffortChange(reasoningEffort: CodexReasoningEffort) {
    const next = normalizeSelectedReasoningEffort(reasoningEffort, codexReasoningEfforts, defaultReasoningEffort);
    setSelectedReasoningEffort(next);
    if (activeSession && next) {
      applyRunProfileLocally({ reasoning_effort: next });
      void persistRunProfile({ reasoning_effort: next });
    } else {
      window.localStorage.setItem(CODEX_REASONING_EFFORT_STORAGE_KEY, next);
    }
  }

  function handleSelectedPermissionModeChange(permissionMode: CodexPermissionMode) {
    const next = normalizeSelectedPermissionMode(permissionMode, codexPermissionModes, defaultPermissionMode);
    setSelectedPermissionMode(next);
    if (activeSession && next) {
      applyRunProfileLocally({ permission_mode: next });
      void persistRunProfile({ permission_mode: next });
    } else {
      window.localStorage.setItem(CODEX_PERMISSION_MODE_STORAGE_KEY, next);
    }
  }

  function handlePlanModeChange(enabled: boolean) {
    setPlanMode(enabled);
    if (activeSession) {
      applyRunProfileLocally({ plan_mode: enabled });
      void persistRunProfile({ plan_mode: enabled });
    } else {
      window.localStorage.setItem(CODEX_PLAN_MODE_STORAGE_KEY, enabled ? "true" : "false");
    }
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

  async function handleAddRepo(input: {
    folderName: string;
    label: string;
    key: string;
    candidateId?: string;
  }) {
    const result = await addRepoRequest(input);
    setRepos(result.repos);
    setDefaultRepoKey(result.defaultRepo);
    setSelectedRepoKey(result.repo.key);
  }

  async function handleRemoveRepo(repoKey: string) {
    const result = await removeRepoRequest(repoKey);
    setRepos(result.repos);
    setDefaultRepoKey(result.defaultRepo);
    setSelectedRepoKey((current) =>
      current && result.repos.some((repo) => repo.key === current)
        ? current
        : result.defaultRepo || (result.repos[0]?.key ?? null)
    );
  }

  async function handleSetDefaultRepo(repoKey: string) {
    const result = await setDefaultRepoRequest(repoKey);
    setRepos(result.repos);
    setDefaultRepoKey(result.defaultRepo);
  }

  async function handleRestartServer() {
    await requestServerRestart();
  }

  const chatTurnBusy = ["CREATED", "RUNNING", "WAITING_FOR_USER"].includes(activeSession?.task_status ?? "IDLE");
  const currentSessionViewPaging = sessionViewPaging[sessionView];

  const consoleVisible =
    (isMobileLayout && mobileTab === "console") || (!isMobileLayout && inspectorTab === "console");
  const consolePanel = (
    <CodexTerminal sessionId={activeSessionId} isVisible={consoleVisible} onStatus={handleTerminalStatus} />
  );
  const changesPanel = (
    <GitStatusPanel
      sessionId={activeSessionId}
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
      selectedModel={composerModel}
      reasoningEfforts={codexReasoningEfforts}
      selectedReasoningEffort={composerReasoningEffort}
      permissionModes={codexPermissionModes}
      selectedPermissionMode={composerPermissionMode}
      planMode={composerPlanMode}
      onSelectedModelChange={handleSelectedModelChange}
      onSelectedReasoningEffortChange={handleSelectedReasoningEffortChange}
      onSelectedPermissionModeChange={handleSelectedPermissionModeChange}
      onPlanModeChange={handlePlanModeChange}
      onSubmitMessage={handleSendChatMessage}
      onSubmitUserInput={handleSubmitChatUserInput}
      onStopTurn={handleStopChatTurn}
      onCreateSession={() => void handleCreateSession()}
      onOpenConsole={() => {
        setInspectorTab("console");
        setMobileTab("console");
      }}
      onOpenChanges={() => {
        setInspectorTab("changes");
        setMobileTab("changes");
      }}
    />
  );
  const inspectorPanel = (
    <InspectorPanel
      activeTab={inspectorTab}
      consolePanel={isMobileLayout ? null : consolePanel}
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
            codexHistoryThreads={codexHistoryThreads}
            activeSessionId={activeSessionId}
            view={sessionView}
            selectedArchiveSessionIds={selectedArchiveSessionIds}
            hasMore={currentSessionViewPaging.loaded && currentSessionViewPaging.hasMore}
            loadingMore={currentSessionViewPaging.loadingMore}
            onSelectRepo={setSelectedRepoKey}
            onManageRepos={() => setRepoSettingsOpen(true)}
            onSelectSession={(sessionId) => {
              setActiveSessionId(sessionId);
              setMobileTab("chat");
            }}
            onCreateSession={() => void handleCreateSession()}
            onViewChange={(nextView) => void handleSessionViewChange(nextView)}
            onToggleArchiveSessionSelection={handleToggleArchiveSessionSelection}
            onToggleAllArchiveSessions={handleToggleAllArchiveSessions}
            onOpenCodexHistoryThread={(thread) => void handleOpenCodexHistoryThread(thread)}
            onArchiveSession={(sessionId) => void handleArchiveSession(sessionId)}
            onDeleteSession={(sessionId) => void handleDeleteSession(sessionId)}
            onDeleteSelectedArchiveSessions={() => void handleDeleteSelectedArchiveSessions()}
            onLoadMore={() => void handleLoadMoreSessions()}
          />
        }
        chat={chatPanel}
        console={isMobileLayout ? consolePanel : null}
        changes={changesPanel}
        inspector={inspectorPanel}
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
      />
      {repoSettingsOpen ? (
        <RepoSettingsPanel
          repos={repos}
          defaultRepo={defaultRepoKey}
          repoDiscovery={repoDiscovery}
          onClose={() => setRepoSettingsOpen(false)}
          onRefresh={refreshRepos}
          onResolveFolder={resolveRepoFolder}
          onAddRepo={handleAddRepo}
          onRemoveRepo={handleRemoveRepo}
          onSetDefaultRepo={handleSetDefaultRepo}
          onRestartServer={handleRestartServer}
        />
      ) : null}
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

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

function upsertSessions(current: CodexSession[], incoming: CodexSession[]): CodexSession[] {
  const byId = new Map(current.map((session) => [session.id, session]));
  for (const session of incoming) {
    byId.set(session.id, session);
  }
  return [...byId.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id));
}

function replaceSessionsForView(
  current: CodexSession[],
  view: Exclude<SessionSidebarView, "history">,
  incoming: CodexSession[]
): CodexSession[] {
  const nextViewIsArchived = view === "archive";
  return upsertSessions(
    current.filter((session) => Boolean(session.archived_at) !== nextViewIsArchived),
    incoming
  );
}

function upsertCodexHistoryThreads(
  current: CodexHistoryThread[],
  incoming: CodexHistoryThread[]
): CodexHistoryThread[] {
  const byKey = new Map(current.map((thread) => [`${thread.repo_key}:${thread.id}`, thread]));
  for (const thread of incoming) {
    byKey.set(`${thread.repo_key}:${thread.id}`, thread);
  }
  return [...byKey.values()].sort(compareCodexHistoryThreads);
}

function compareCodexHistoryThreads(a: CodexHistoryThread, b: CodexHistoryThread): number {
  const timeCompare = historySortAt(b).localeCompare(historySortAt(a));
  if (timeCompare !== 0) {
    return timeCompare;
  }
  const repoCompare = a.repo_key.localeCompare(b.repo_key);
  return repoCompare || b.id.localeCompare(a.id);
}

function historySortAt(thread: CodexHistoryThread): string {
  return thread.updated_at ?? thread.created_at ?? "";
}

function createInitialSessionViewPaging(): Record<SessionSidebarView, SessionViewPaging> {
  return {
    active: createEmptySessionViewPaging(),
    archive: createEmptySessionViewPaging(),
    history: createEmptySessionViewPaging()
  };
}

function createEmptySessionViewPaging(): SessionViewPaging {
  return {
    nextCursor: null,
    hasMore: true,
    loaded: false,
    loadingMore: false
  };
}

function mergeSessionViewPaging(
  current: SessionViewPaging,
  result: { next_cursor: string | null; has_more: boolean },
  keepLoadedCursor: boolean
): SessionViewPaging {
  const hasMore = keepLoadedCursor && current.loaded && !current.hasMore ? false : result.has_more;
  return {
    ...current,
    loaded: true,
    hasMore,
    nextCursor: hasMore
      ? keepLoadedCursor && current.loaded
        ? current.nextCursor ?? result.next_cursor
        : result.next_cursor
      : null
  };
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
