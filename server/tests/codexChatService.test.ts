import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CodexChatService } from "../src/services/codexChatService";
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
  created_at: "2026-05-11T00:00:00.000Z",
  updated_at: "2026-05-11T00:00:00.000Z",
  started_at: null,
  closed_at: null,
  last_output_at: null,
  archived_at: null
};

describe("codex chat service models", () => {
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
        itemId: "answer-item",
        delta: "Tôi dùng quy chuẩn `DESIGN.md`."
      }
    });

    const [stored] = await messageStore.list(session.id);
    expect(stored.activities[0].content).toBe("Tôi sẽ làm ở chế độ mockup/phân tích thôi.");
    expect(stored.content).toBe("Tôi dùng quy chuẩn `DESIGN.md`.");
  });
});
