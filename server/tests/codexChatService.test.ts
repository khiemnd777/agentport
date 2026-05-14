import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CodexChatService, wrapPromptForManagedPlanMode } from "../src/services/codexChatService";
import type { AppConfig } from "../src/config";
import type { CodexSession } from "../src/domain/sessionTypes";
import { ChatMessageStore } from "../src/services/chatMessageStore";
import { AttachmentService } from "../src/services/attachmentService";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const config: AppConfig = {
  server: { host: "127.0.0.1", port: 8787 },
  auth: { requirePassword: false },
  repos: {},
  defaultRepo: "noah",
  repoDiscovery: { searchRoots: [], maxDepth: 4 },
  codex: {
    command: "codex",
    defaultArgs: [],
    taskTimeoutMinutes: 60,
    defaultModel: "gpt-5.5",
    models: [
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4", label: "GPT-5.4" }
    ],
    defaultReasoningEffort: "medium",
    reasoningEfforts: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "xhigh", label: "Extra High" }
    ],
    defaultPermissionMode: "default",
    permissionModes: [
      {
        id: "default",
        label: "Default permissions",
        description: "Ask before sensitive actions while keeping the workspace sandbox on.",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: "workspace-write"
      },
      {
        id: "auto-review",
        label: "Auto-review",
        description: "Route eligible approval requests through Codex auto-review in the workspace sandbox.",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandbox: "workspace-write"
      }
    ]
  },
  limits: { maxActiveSessions: 1, maxActiveTasks: 1, maxLogBytesPerSession: 1024 },
  sessions: { autoArchiveStoppedAfterMinutes: 0, deleteArchivedAfterDays: 30 }
};

const session: CodexSession = {
  id: "11111111-1111-4111-8111-111111111111",
  repo_key: "noah",
  repo_path: "/tmp/noah",
  branch_name: null,
  title: "Noah",
  source: "desktop_web",
  control_mode: "web_managed",
  terminal_status: "CONNECTED",
  task_status: "IDLE",
  active_task_id: null,
  codex_thread_id: null,
  sync_status: "local_only",
  control_state: "observing",
  last_synced_at: null,
  last_sync_error: null,
  codex_thread_updated_at: null,
  run_profile: {
    model: "gpt-5.5",
    reasoning_effort: "medium",
    permission_mode: "default",
    plan_mode: false,
    updated_at: "2026-05-11T00:00:00.000Z"
  },
  waiting_user_input: null,
  created_at: "2026-05-11T00:00:00.000Z",
  updated_at: "2026-05-11T00:00:00.000Z",
  started_at: null,
  closed_at: null,
  last_output_at: null,
  archived_at: null
};

describe("codex chat service models", () => {
  test("wraps managed plan mode prompts with confirmation instructions", () => {
    const wrapped = wrapPromptForManagedPlanMode("Implement the feature");

    expect(wrapped).toContain("Agent Port managed plan-first mode is enabled");
    expect(wrapped).toContain("Do not edit files");
    expect(wrapped).toContain("available user-input request flow");
    expect(wrapped).toContain("Implement the feature");
  });

  test("lists configured public models", () => {
    const service = new CodexChatService(config, null as never, null as never, null as never);
    expect(service.listModels()).toEqual({
      defaultModel: "gpt-5.5",
      defaultReasoningEffort: "medium",
      models: [
        { id: "gpt-5.5", label: "GPT-5.5" },
        { id: "gpt-5.4", label: "GPT-5.4" }
      ],
      reasoningEfforts: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "xhigh", label: "Extra High" }
      ],
      defaultPermissionMode: "default",
      permissionModes: [
        {
          id: "default",
          label: "Default permissions",
          description: "Ask before sensitive actions while keeping the workspace sandbox on.",
          highRisk: false
        },
        {
          id: "auto-review",
          label: "Auto-review",
          description: "Route eligible approval requests through Codex auto-review in the workspace sandbox.",
          highRisk: false
        }
      ]
    });
  });

  test("lists Codex history from whitelisted repos without exposing paths", async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const repo = { key: "noah", label: "Noah", path: "/private/noah" };
    const createdAt = Date.parse("2026-05-14T00:00:00.000Z") / 1000;
    const updatedAt = Date.parse("2026-05-14T00:01:00.000Z") / 1000;
    const service = new CodexChatService(
      config,
      {
        findByCodexThreadId: () => null,
        isCodexThreadForgotten: () => false
      } as never,
      null as never,
      null as never,
      null,
      {
        list: () => [repo],
        getRepo: () => repo
      } as never,
      {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onExit: () => undefined,
        request: async (method: string, params: Record<string, unknown>) => {
          requests.push({ method, params });
          return {
            data: [
              {
                id: "thread-1",
                name: "Giảm dung lượng logo intake",
                createdAt,
                updatedAt,
                status: { type: "active" }
              }
            ]
          };
        }
      } as never
    );

    const threads = await service.listCodexHistory("noah");

    expect(requests[0]).toMatchObject({ method: "thread/list", params: { cwd: "/private/noah" } });
    expect(threads).toEqual([
      {
        id: "thread-1",
        title: "Giảm dung lượng logo intake",
        repo_key: "noah",
        repo_label: "Noah",
        created_at: "2026-05-14T00:00:00.000Z",
        updated_at: "2026-05-14T00:01:00.000Z",
        control_state: "desktop_active",
        imported_session_id: null,
        forgotten: false
      }
    ]);
    expect(JSON.stringify(threads)).not.toContain("/private/noah");
  });

  test("keeps locally represented Codex threads out of Codex history", async () => {
    const repo = { key: "noah", label: "Noah", path: "/private/noah" };
    const service = new CodexChatService(
      config,
      {
        findByCodexThreadId: (threadId: string) =>
          threadId === "thread-active" ? ({ id: "11111111-1111-4111-8111-111111111111" } as CodexSession) : null,
        isCodexThreadForgotten: () => false
      } as never,
      null as never,
      null as never,
      null,
      {
        list: () => [repo],
        getRepo: () => repo
      } as never,
      {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onExit: () => undefined,
        request: async () => ({
          data: [
            { id: "thread-active", name: "Active local thread", updatedAt: 1778716800, status: { type: "inactive" } },
            { id: "thread-history", name: "History only thread", updatedAt: 1778716900, status: { type: "inactive" } }
          ]
        })
      } as never
    );

    expect((await service.listCodexHistory("noah")).map((thread) => thread.id)).toEqual(["thread-history"]);
  });

  test("pages Codex history with stable cursors", async () => {
    const repo = { key: "noah", label: "Noah", path: "/private/noah" };
    const service = new CodexChatService(
      config,
      {
        findByCodexThreadId: () => null,
        isCodexThreadForgotten: () => false
      } as never,
      null as never,
      null as never,
      null,
      {
        list: () => [repo],
        getRepo: () => repo
      } as never,
      {
        onNotification: () => undefined,
        onServerRequest: () => undefined,
        onExit: () => undefined,
        request: async () => ({
          data: [
            { id: "thread-oldest", name: "Oldest", updatedAt: 1778716800, status: { type: "inactive" } },
            { id: "thread-middle", name: "Middle", updatedAt: 1778716900, status: { type: "inactive" } },
            { id: "thread-newest", name: "Newest", updatedAt: 1778717000, status: { type: "inactive" } }
          ]
        })
      } as never
    );

    const firstPage = await service.listCodexHistoryPage("noah", { limit: 2 });
    const secondPage = await service.listCodexHistoryPage("noah", { limit: 2, cursor: firstPage.next_cursor });

    expect(firstPage.items.map((thread) => thread.id)).toEqual(["thread-newest", "thread-middle"]);
    expect(firstPage.has_more).toBe(true);
    expect(typeof firstPage.next_cursor).toBe("string");
    expect(secondPage.items.map((thread) => thread.id)).toEqual(["thread-oldest"]);
    expect(secondPage.has_more).toBe(false);
  });

  test("rejects unsupported model before starting a turn", async () => {
    const service = new CodexChatService(config, null as never, null as never, null as never);
    await expect(service.sendMessage(session, "hello", "not-allowed")).rejects.toThrow("Unsupported Codex model");
  });

  test("rejects unsupported reasoning effort before starting a turn", async () => {
    const service = new CodexChatService(config, null as never, null as never, null as never);
    await expect(service.sendMessage(session, "hello", "gpt-5.5", "minimal")).rejects.toThrow(
      "Unsupported Codex reasoning effort"
    );
  });

  test("rejects unsupported permission mode before starting a turn", async () => {
    const service = new CodexChatService(config, null as never, null as never, null as never);
    await expect(service.sendMessage(session, "hello", "gpt-5.5", "medium", "root")).rejects.toThrow(
      "Unsupported Codex permission mode"
    );
  });

  test("rejects unknown and foreign attachment ids before starting a turn", async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), "agent-port-chat-attachments-"));
    tempRoots.push(dataRoot);
    const attachmentService = new AttachmentService(dataRoot);
    await attachmentService.init();
    const service = new CodexChatService(config, null as never, null as never, null as never, attachmentService);

    await expect(service.sendMessage(session, "hello", undefined, undefined, undefined, [randomUUID()])).rejects.toThrow(
      "Attachment not found for session"
    );

    const foreignAttachment = await attachmentService.create(
      randomUUID(),
      new File(["hello"], "foreign.txt", { type: "text/plain" })
    );
    await expect(
      service.sendMessage(session, "hello", undefined, undefined, undefined, [foreignAttachment.id])
    ).rejects.toThrow("Attachment not found for session");
  });
});

describe("codex chat service streaming", () => {
  test("keeps started commentary text out of assistant answer content", async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), "agent-port-chat-"));
    tempRoots.push(dataRoot);
    const messageStore = new ChatMessageStore(dataRoot);
    await messageStore.init();
    const assistantMessage = await messageStore.create({
      sessionId: session.id,
      role: "assistant",
      content: "",
      status: "streaming",
      turnId: "turn-1"
    });
    const service = new CodexChatService(
      config,
      {
        setCodexThreadId: async () => undefined,
        setTaskState: async () => undefined,
        getPublic: () => session
      } as never,
      messageStore,
      { broadcast: () => undefined } as never
    );
    const serviceInternals = service as unknown as {
      activeTurns: Map<string, unknown>;
      handleAppServerNotification: (
        sessionId: string,
        assistantMessageId: string,
        message: Record<string, unknown>
      ) => Promise<void>;
    };
    serviceInternals.activeTurns.set(session.id, {
      client: { close: () => undefined },
      assistantMessageId: assistantMessage.id,
      threadId: null,
      turnId: null,
      finished: false,
      itemTargets: new Map()
    });

    await serviceInternals.handleAppServerNotification(session.id, assistantMessage.id, {
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "agentMessage",
          id: "thinking-item",
          phase: "commentary",
          text: "Tôi sẽ làm ở chế độ mockup/phân tích thôi."
        }
      }
    });
    await serviceInternals.handleAppServerNotification(session.id, assistantMessage.id, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        delta: " Tôi đang kiểm tra `rg`."
      }
    });
    await serviceInternals.handleAppServerNotification(session.id, assistantMessage.id, {
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "agentMessage",
          id: "answer-item",
          phase: null,
          text: "Tôi sẽ làm ở chế độ mockup/phân tích thôi."
        }
      }
    });
    await serviceInternals.handleAppServerNotification(session.id, assistantMessage.id, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        delta: "Tôi dùng quy chuẩn `DESIGN.md`."
      }
    });

    const [stored] = await messageStore.list(session.id);
    expect(stored.activities[0].content).toBe(
      "Tôi sẽ làm ở chế độ mockup/phân tích thôi. Tôi đang kiểm tra `rg`."
    );
    expect(stored.content).toBe("Tôi dùng quy chuẩn `DESIGN.md`.");
  });

  test("does not append untargeted thinking deltas into assistant answer content", async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), "agent-port-chat-thinking-leak-"));
    tempRoots.push(dataRoot);
    const messageStore = new ChatMessageStore(dataRoot);
    await messageStore.init();
    const assistantMessage = await messageStore.create({
      sessionId: session.id,
      role: "assistant",
      content: "",
      status: "streaming",
      turnId: "turn-1"
    });
    const service = new CodexChatService(
      config,
      {
        setCodexThreadId: async () => undefined,
        setTaskState: async () => undefined,
        getPublic: () => session
      } as never,
      messageStore,
      { broadcast: () => undefined } as never
    );
    const serviceInternals = service as unknown as {
      activeTurns: Map<string, unknown>;
      handleAppServerNotification: (
        sessionId: string,
        assistantMessageId: string,
        message: Record<string, unknown>
      ) => Promise<void>;
    };
    serviceInternals.activeTurns.set(session.id, {
      assistantMessageId: assistantMessage.id,
      threadId: "thread-1",
      turnId: "turn-1",
      finished: false,
      pendingUserInput: null,
      itemTargets: new Map(),
      currentAgentMessageItemId: null,
      currentAgentMessageTarget: null
    });

    await serviceInternals.handleAppServerNotification(session.id, assistantMessage.id, {
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "agentMessage",
          id: "thinking-item",
          phase: "commentary",
          text: "Tôi sẽ lưu trạng thái này trên borrower."
        }
      }
    });
    await serviceInternals.handleAppServerNotification(session.id, assistantMessage.id, {
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "agentMessage",
          id: "thinking-item",
          phase: "commentary",
          text: "Tôi sẽ lưu trạng thái này trên borrower."
        }
      }
    });
    await serviceInternals.handleAppServerNotification(session.id, assistantMessage.id, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        delta: "Tôi sẽ lưu"
      }
    });

    const [stored] = await messageStore.list(session.id);
    expect(stored.activities[0].content).toBe("Tôi sẽ lưu trạng thái này trên borrower.");
    expect(stored.content).toBe("");
  });

  test("bridges app-server user input requests through WAITING_FOR_USER", async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), "agent-port-chat-input-"));
    tempRoots.push(dataRoot);
    const messageStore = new ChatMessageStore(dataRoot);
    await messageStore.init();
    const assistantMessage = await messageStore.create({
      sessionId: session.id,
      role: "assistant",
      content: "",
      status: "streaming",
      turnId: "turn-1"
    });
    let storedSession: CodexSession = { ...session, task_status: "RUNNING" };
    const responses: Array<{ id: number; result: unknown }> = [];
    const broadcasts: unknown[] = [];
    const service = new CodexChatService(
      config,
      {
        setCodexThreadId: async () => storedSession,
        setTaskState: async (_sessionId: string, taskStatus: CodexSession["task_status"]) => {
          storedSession = {
            ...storedSession,
            task_status: taskStatus,
            waiting_user_input: taskStatus === "WAITING_FOR_USER" ? storedSession.waiting_user_input : null
          };
          return storedSession;
        },
        setWaitingUserInput: async (_sessionId: string, waitingUserInput: CodexSession["waiting_user_input"]) => {
          storedSession = {
            ...storedSession,
            task_status: "WAITING_FOR_USER",
            waiting_user_input: waitingUserInput
          };
          return storedSession;
        },
        get: () => storedSession,
        getPublic: () => storedSession
      } as never,
      messageStore,
      { broadcast: (_sessionId: string, payload: unknown) => broadcasts.push(payload) } as never
    );
    const client = {
      respond: (id: number, result: unknown) => responses.push({ id, result }),
      request: async () => ({}),
      close: () => undefined
    };
    const serviceInternals = service as unknown as {
      activeTurns: Map<string, unknown>;
      handleAppServerRequest: (
        sessionId: string,
        client: { respond: (id: number, result: unknown) => void; request: () => Promise<unknown>; close: () => void },
        message: Record<string, unknown>
      ) => Promise<void>;
    };
    serviceInternals.activeTurns.set(session.id, {
      client,
      assistantMessageId: assistantMessage.id,
      threadId: "thread-1",
      turnId: "turn-1",
      finished: false,
      pendingUserInput: null,
      itemTargets: new Map()
    });

    await serviceInternals.handleAppServerRequest(session.id, client, {
      id: 42,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "input-1",
        questions: [
          {
            id: "confirm",
            header: "Plan",
            question: "Confirm this plan?",
            isOther: true,
            isSecret: false,
            options: [{ label: "Proceed", description: "Run the approved plan." }]
          }
        ]
      }
    });

    expect(storedSession.task_status).toBe("WAITING_FOR_USER");
    expect(storedSession.waiting_user_input?.message).toContain("Confirm this plan?");
    expect(responses).toHaveLength(0);

    const result = await service.submitUserInput(storedSession, "Confirm plan");

    expect(result.messages[0]?.content).toBe("Confirm plan");
    expect(storedSession.task_status).toBe("RUNNING");
    expect(storedSession.waiting_user_input).toBeNull();
    expect(responses).toEqual([
      {
        id: 42,
        result: {
          answers: {
            confirm: { answers: ["Proceed"] }
          }
        }
      }
    ]);
    expect(broadcasts.length).toBeGreaterThan(0);
  });

  test("routes shared app-server notifications only to the matching active thread", async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), "agent-port-chat-shared-"));
    tempRoots.push(dataRoot);
    const messageStore = new ChatMessageStore(dataRoot);
    await messageStore.init();
    const otherSession: CodexSession = {
      ...session,
      id: "22222222-2222-4222-8222-222222222222",
      title: "Other",
      codex_thread_id: "thread-2"
    };
    const firstAssistant = await messageStore.create({
      sessionId: session.id,
      role: "assistant",
      content: "",
      status: "streaming",
      turnId: "turn-1"
    });
    const secondAssistant = await messageStore.create({
      sessionId: otherSession.id,
      role: "assistant",
      content: "",
      status: "streaming",
      turnId: "turn-2"
    });
    const service = new CodexChatService(
      config,
      {
        setCodexThreadId: async () => session,
        getPublic: (sessionId: string) => (sessionId === otherSession.id ? otherSession : session)
      } as never,
      messageStore,
      { broadcast: () => undefined } as never
    );
    const serviceInternals = service as unknown as {
      activeTurns: Map<string, unknown>;
      handleSharedAppServerNotification: (message: Record<string, unknown>) => Promise<void>;
    };
    serviceInternals.activeTurns.set(session.id, {
      assistantMessageId: firstAssistant.id,
      threadId: "thread-1",
      turnId: "turn-1",
      finished: false,
      itemTargets: new Map()
    });
    serviceInternals.activeTurns.set(otherSession.id, {
      assistantMessageId: secondAssistant.id,
      threadId: "thread-2",
      turnId: "turn-2",
      finished: false,
      itemTargets: new Map()
    });

    await serviceInternals.handleSharedAppServerNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "agentMessage",
          id: "answer-item",
          phase: null
        }
      }
    });
    await serviceInternals.handleSharedAppServerNotification({
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        delta: "Only thread one"
      }
    });

    const [firstStored] = await messageStore.list(session.id);
    const [secondStored] = await messageStore.list(otherSession.id);
    expect(firstStored.content).toBe("Only thread one");
    expect(secondStored.content).toBe("");
  });
});
