import type {
  AppConfig,
  CodexApprovalsReviewer,
  CodexApprovalPolicy,
  CodexPermissionMode,
  CodexPermissionModeConfig,
  CodexReasoningEffort,
  CodexSandboxMode
} from "../config";
import type { PublicAttachmentMetadata } from "../domain/attachmentTypes";
import type { ChatMessage } from "../domain/chatTypes";
import type { CodexSession, WaitingUserInput, WaitingUserInputQuestion } from "../domain/sessionTypes";
import { badRequest, conflict } from "../utils/httpErrors";
import { createId, nowIso } from "../utils/ids";
import {
  extractAgentDeltaFromCodexEvent,
  extractFinalAgentTextFromCodexEvent,
  extractThreadIdFromCodexEvent
} from "./codexExecEventParser";
import { CodexAppServerClient, type AppServerMessage } from "./codexAppServerClient";
import type { AttachmentRecord, AttachmentService } from "./attachmentService";
import type { ChatMessageStore } from "./chatMessageStore";
import type { SessionService } from "./sessionService";
import type { ChatSocketBroadcaster } from "../websocket/chatSocket";

interface ActiveTurn {
  client: CodexAppServerClient;
  assistantMessageId: string;
  threadId: string | null;
  turnId: string | null;
  finished: boolean;
  pendingUserInput: PendingUserInputRequest | null;
  itemTargets: Map<string, ItemTarget>;
}

type JsonRecord = Record<string, unknown>;
type ItemTarget = { target: "assistant" } | { target: "activity"; activityId: string };
interface PendingUserInputRequest {
  requestId: number;
  client: CodexAppServerClient;
  threadId: string | null;
  turnId: string | null;
  questions: WaitingUserInputQuestion[];
}

export interface PublicCodexModel {
  id: string;
  label: string;
}

export interface PublicCodexReasoningEffort {
  id: CodexReasoningEffort;
  label: string;
}

export interface PublicCodexPermissionMode {
  id: CodexPermissionMode;
  label: string;
  description: string;
  highRisk: boolean;
}

interface CodexRuntimePermissions {
  approvalPolicy: CodexApprovalPolicy;
  approvalsReviewer: CodexApprovalsReviewer;
  sandbox: CodexSandboxMode;
}

interface SendMessageOptions {
  planMode?: boolean;
}

const AGENT_PORT_DEVELOPER_INSTRUCTIONS = `You are running inside Agent Port, a browser-based remote control layer for local Codex.

Follow the repository AGENTS.md and local project instructions. Treat this as a remote-managed session. Before risky or ambiguous changes, ask a concise question. When changing code, run relevant validation before completion and summarize changed files plus validation results.`;

const MANAGED_PLAN_MODE_PREFIX = `Agent Port managed plan-first mode is enabled for this turn.

Rules for this turn:
1. Analyze the request and produce a concise implementation plan before editing files.
2. Do not edit files, run write commands, or perform destructive actions until the user confirms the plan.
3. Ask for confirmation using the available user-input request flow. The Agent Port browser will surface that request and route the user's confirmation back to this same Codex app-server turn.
4. If the user requests changes to the plan, revise the plan and ask again before implementation.
5. After confirmation, continue the task normally and run relevant validation before completion.

User request:`;

export class CodexChatService {
  private readonly activeTurns = new Map<string, ActiveTurn>();

  constructor(
    private readonly config: AppConfig,
    private readonly sessionService: SessionService,
    private readonly messageStore: ChatMessageStore,
    private readonly broadcaster: ChatSocketBroadcaster,
    private readonly attachmentService: AttachmentService | null = null
  ) {}

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.messageStore.list(sessionId);
  }

  listModels(): {
    models: PublicCodexModel[];
    defaultModel: string;
    reasoningEfforts: PublicCodexReasoningEffort[];
    defaultReasoningEffort: CodexReasoningEffort;
    permissionModes: PublicCodexPermissionMode[];
    defaultPermissionMode: CodexPermissionMode;
  } {
    return {
      models: this.config.codex.models.map((model) => ({ id: model.id, label: model.label })),
      defaultModel: this.config.codex.defaultModel,
      reasoningEfforts: this.config.codex.reasoningEfforts.map((effort) => ({ id: effort.id, label: effort.label })),
      defaultReasoningEffort: this.config.codex.defaultReasoningEffort,
      permissionModes: this.config.codex.permissionModes.map(toPublicPermissionMode),
      defaultPermissionMode: this.config.codex.defaultPermissionMode
    };
  }

  async sendMessage(
    session: CodexSession,
    promptInput: string,
    modelInput?: string,
    effortInput?: string,
    permissionModeInput?: string,
    attachmentIds?: unknown,
    options: SendMessageOptions = {}
  ): Promise<{ messages: ChatMessage[] }> {
    const prompt = promptInput.trim();
    const model = this.resolveModel(modelInput);
    const effort = this.resolveReasoningEffort(effortInput);
    const permissions = this.resolvePermissionMode(permissionModeInput);
    const attachments = await this.resolveAttachments(session.id, attachmentIds);
    if (!prompt && !attachments.length) {
      throw badRequest("Message prompt or attachment is required");
    }
    if (session.archived_at) {
      throw conflict("Archived sessions are read-only");
    }
    if (this.activeTurns.has(session.id) || ["CREATED", "RUNNING", "WAITING_FOR_USER"].includes(session.task_status)) {
      throw conflict("Agent is still working in this chat");
    }

    const turnId = createId();
    const userMessage = await this.messageStore.create({
      sessionId: session.id,
      role: "user",
      content: prompt,
      status: "complete",
      turnId,
      attachments: attachments.map(toPublicAttachment)
    });
    const assistantMessage = await this.messageStore.create({
      sessionId: session.id,
      role: "assistant",
      content: "",
      status: "streaming",
      turnId
    });
    this.broadcaster.broadcast(session.id, { type: "message_created", sessionId: session.id, message: userMessage });
    this.broadcaster.broadcast(session.id, { type: "message_created", sessionId: session.id, message: assistantMessage });
    await this.sessionService.setTaskState(session.id, "RUNNING", null);
    this.broadcastSessionStatus(session.id);

    this.startCodexAppServerTurn(
      session,
      prompt,
      model,
      effort,
      permissions,
      assistantMessage.id,
      attachments,
      options.planMode === true
    );

    return { messages: [userMessage, assistantMessage] };
  }

  async submitUserInput(session: CodexSession, textInput: string): Promise<{ messages: ChatMessage[] }> {
    const text = textInput.trim();
    if (!text) {
      throw badRequest("Input text is required");
    }
    if (session.archived_at) {
      throw conflict("Archived sessions are read-only");
    }

    const active = this.activeTurns.get(session.id);
    if (!active || active.finished) {
      throw conflict("No active Codex turn is waiting for input");
    }
    if (session.task_status !== "WAITING_FOR_USER" && !active.pendingUserInput) {
      throw conflict("Codex is not waiting for user input");
    }
    if (!active.pendingUserInput && (!active.threadId || !active.turnId)) {
      throw conflict("Codex turn is not ready for follow-up input");
    }

    const userMessage = await this.messageStore.create({
      sessionId: session.id,
      role: "user",
      content: text,
      status: "complete",
      turnId: active.turnId
    });
    this.broadcaster.broadcast(session.id, { type: "message_created", sessionId: session.id, message: userMessage });

    if (active.pendingUserInput) {
      const pending = active.pendingUserInput;
      active.pendingUserInput = null;
      pending.client.respond(pending.requestId, {
        answers: buildUserInputResponseAnswers(pending.questions, text)
      });
    } else if (active.threadId && active.turnId) {
      await active.client.request("turn/steer", {
        threadId: active.threadId,
        expectedTurnId: active.turnId,
        input: buildCodexInput(text, [])
      });
    }

    await this.sessionService.setTaskState(session.id, "RUNNING", null);
    this.broadcastSessionStatus(session.id);
    return { messages: [userMessage] };
  }

  async interrupt(sessionId: string): Promise<void> {
    const active = this.activeTurns.get(sessionId);
    if (!active) {
      return;
    }
    if (active.threadId && active.turnId) {
      await active.client
        .request("turn/interrupt", { threadId: active.threadId, turnId: active.turnId })
        .catch(() => undefined);
    }
    active.client.close();
    this.activeTurns.delete(sessionId);
    await this.messageStore.setStatus(sessionId, active.assistantMessageId, "error", "Interrupted");
    await this.sessionService.setTaskState(sessionId, "CANCELLED", null);
    await this.broadcastMessageUpdate(sessionId, active.assistantMessageId);
    this.broadcastSessionStatus(sessionId);
  }

  async deleteForSession(sessionId: string): Promise<void> {
    await this.interrupt(sessionId);
    await this.messageStore.deleteForSession(sessionId);
    await this.attachmentService?.deleteForSession(sessionId);
  }

  private startCodexAppServerTurn(
    session: CodexSession,
    prompt: string,
    model: string,
    effort: CodexReasoningEffort,
    permissions: CodexRuntimePermissions,
    assistantMessageId: string,
    attachments: AttachmentRecord[],
    planMode: boolean
  ): void {
    const client = new CodexAppServerClient(
      this.config.codex.command,
      this.config.codex.defaultArgs,
      (message) => {
        void this.handleAppServerNotification(session.id, assistantMessageId, message);
      },
      (client, message) => {
        void this.handleAppServerRequest(session.id, client, message);
      },
      (error) => {
        const active = this.activeTurns.get(session.id);
        if (active?.assistantMessageId === assistantMessageId) {
          void this.failTurn(session.id, active, error.message);
        }
      }
    );
    const active: ActiveTurn = {
      client,
      assistantMessageId,
      threadId: session.codex_thread_id,
      turnId: null,
      finished: false,
      pendingUserInput: null,
      itemTargets: new Map()
    };
    this.activeTurns.set(session.id, active);

    void this.runCodexAppServerTurn(session, prompt, model, effort, permissions, attachments, active, planMode).catch((error) => {
      void this.failTurn(session.id, active, (error as Error).message);
    });
  }

  private async runCodexAppServerTurn(
    session: CodexSession,
    prompt: string,
    model: string,
    effort: CodexReasoningEffort,
    permissions: CodexRuntimePermissions,
    attachments: AttachmentRecord[],
    active: ActiveTurn,
    planMode: boolean
  ): Promise<void> {
    await active.client.initialize();
    let thread: { thread: { id: string } };
    if (active.threadId) {
      thread = await active.client.request<{ thread: { id: string } }>("thread/resume", {
        threadId: active.threadId,
        model,
        cwd: session.repo_path,
        approvalPolicy: permissions.approvalPolicy,
        approvalsReviewer: permissions.approvalsReviewer,
        sandbox: permissions.sandbox,
        developerInstructions: AGENT_PORT_DEVELOPER_INSTRUCTIONS
      }).catch(() => {
        active.threadId = null;
        return this.startAppServerThread(active, session.repo_path, model, permissions);
      });
    } else {
      thread = await this.startAppServerThread(active, session.repo_path, model, permissions);
    }

    active.threadId = thread.thread.id;
    await this.sessionService.setCodexThreadId(session.id, thread.thread.id);

    const turn = await active.client.request<{ turn: { id: string } }>("turn/start", {
      threadId: thread.thread.id,
      input: buildCodexInput(prompt, attachments, { planMode }),
      cwd: session.repo_path,
      approvalPolicy: permissions.approvalPolicy,
      approvalsReviewer: permissions.approvalsReviewer,
      model,
      effort
    });
    active.turnId = turn.turn.id;
    await this.messageStore.setTurnStarted(session.id, active.assistantMessageId);
    await this.broadcastMessageUpdate(session.id, active.assistantMessageId);
  }

  private startAppServerThread(
    active: ActiveTurn,
    cwd: string,
    model: string,
    permissions: CodexRuntimePermissions
  ): Promise<{ thread: { id: string } }> {
    return active.client.request("thread/start", {
      model,
      cwd,
      approvalPolicy: permissions.approvalPolicy,
      approvalsReviewer: permissions.approvalsReviewer,
      sandbox: permissions.sandbox,
      developerInstructions: AGENT_PORT_DEVELOPER_INSTRUCTIONS,
      threadSource: "user"
    });
  }

  private resolveModel(modelInput: string | undefined): string {
    const model = modelInput?.trim() || this.config.codex.defaultModel;
    if (!this.config.codex.models.some((item) => item.id === model)) {
      throw badRequest("Unsupported Codex model");
    }
    return model;
  }

  private resolveReasoningEffort(effortInput: string | undefined): CodexReasoningEffort {
    const effort = effortInput?.trim() || this.config.codex.defaultReasoningEffort;
    const match = this.config.codex.reasoningEfforts.find((item) => item.id === effort);
    if (!match) {
      throw badRequest("Unsupported Codex reasoning effort");
    }
    return match.id;
  }

  private resolvePermissionMode(modeInput: string | undefined): CodexRuntimePermissions {
    const mode = modeInput?.trim() || this.config.codex.defaultPermissionMode;
    const match = this.config.codex.permissionModes.find((item) => item.id === mode);
    if (!match) {
      throw badRequest("Unsupported Codex permission mode");
    }
    return {
      approvalPolicy: match.approvalPolicy,
      approvalsReviewer: match.approvalsReviewer,
      sandbox: match.sandbox
    };
  }

  private async resolveAttachments(sessionId: string, attachmentIds: unknown): Promise<AttachmentRecord[]> {
    if (!attachmentIds || (Array.isArray(attachmentIds) && attachmentIds.length === 0)) {
      return [];
    }
    if (!this.attachmentService) {
      throw badRequest("Attachments are not available");
    }
    return this.attachmentService.resolveForMessage(sessionId, attachmentIds);
  }

  private async handleAppServerNotification(
    sessionId: string,
    assistantMessageId: string,
    message: AppServerMessage
  ): Promise<void> {
    const active = this.activeTurns.get(sessionId);
    if (!active || active.assistantMessageId !== assistantMessageId || active.finished) {
      return;
    }

    const threadId = extractThreadIdFromCodexEvent(message);
    if (threadId) {
      active.threadId = threadId;
      await this.sessionService.setCodexThreadId(sessionId, threadId);
    }

    const turnId = extractTurnIdFromAppServerMessage(message);
    if (turnId) {
      active.turnId = turnId;
    }

    if (message.method === "turn/started" && this.messageBelongsToActiveTurn(message, active)) {
      await this.messageStore.setTurnStarted(sessionId, assistantMessageId);
      await this.broadcastMessageUpdate(sessionId, assistantMessageId);
      return;
    }

    if (message.method === "thread/status/changed") {
      await this.handleThreadStatusChanged(sessionId, active, message);
      return;
    }

    if (message.method === "serverRequest/resolved") {
      await this.handleServerRequestResolved(sessionId, active, message);
      return;
    }

    if (message.method === "turn/plan/updated" && this.messageBelongsToActiveTurn(message, active)) {
      await this.handlePlanUpdated(sessionId, active, message);
      return;
    }

    if (message.method === "item/started" && this.messageBelongsToActiveTurn(message, active)) {
      await this.handleItemStarted(sessionId, active, message);
      return;
    }

    const planDelta = extractPlanDeltaFromAppServerMessage(message);
    if (planDelta && this.messageBelongsToActiveTurn(message, active)) {
      const itemId = extractItemIdFromAppServerMessage(message);
      const target = itemId ? active.itemTargets.get(itemId) : null;
      if (target?.target === "activity") {
        await this.messageStore.appendActivityContent(sessionId, assistantMessageId, target.activityId, planDelta);
        await this.broadcastMessageUpdate(sessionId, assistantMessageId);
      } else if (itemId) {
        const activity = await this.messageStore.upsertActivity(sessionId, assistantMessageId, {
          itemId,
          kind: "thinking",
          title: "Plan",
          content: planDelta,
          status: "streaming"
        });
        if (activity) {
          active.itemTargets.set(itemId, { target: "activity", activityId: activity.id });
          await this.broadcastMessageUpdate(sessionId, assistantMessageId);
        }
      }
      return;
    }

    const delta = extractAgentDeltaFromCodexEvent(message);
    if (delta && this.messageBelongsToActiveTurn(message, active)) {
      const itemId = extractItemIdFromAppServerMessage(message);
      const target = itemId ? active.itemTargets.get(itemId) : null;
      if (target?.target === "activity") {
        await this.messageStore.appendActivityContent(sessionId, assistantMessageId, target.activityId, delta);
        await this.broadcastMessageUpdate(sessionId, assistantMessageId);
      } else {
        await this.messageStore.appendContent(sessionId, assistantMessageId, delta);
        this.broadcaster.broadcast(sessionId, {
          type: "message_delta",
          sessionId,
          messageId: assistantMessageId,
          delta
        });
      }
      return;
    }

    if (message.method === "item/completed" && this.messageBelongsToActiveTurn(message, active)) {
      await this.handleItemCompleted(sessionId, active, message);
      return;
    }

    const finalText = extractFinalAgentTextFromCodexEvent(message);
    if (finalText && this.messageBelongsToActiveTurn(message, active)) {
      await this.messageStore.setContent(sessionId, assistantMessageId, finalText);
      await this.broadcastMessageUpdate(sessionId, assistantMessageId);
      return;
    }

    if (message.method === "turn/completed" && this.messageBelongsToActiveTurn(message, active)) {
      await this.completeTurn(sessionId, active, message);
      return;
    }

    if (message.method === "error" && this.messageBelongsToActiveTurn(message, active)) {
      await this.failTurn(sessionId, active, readAppServerError(message));
    }
  }

  private async handleAppServerRequest(
    sessionId: string,
    client: CodexAppServerClient,
    message: AppServerMessage
  ): Promise<void> {
    const id = typeof message.id === "number" ? message.id : null;
    const method = typeof message.method === "string" ? message.method : "";
    if (id === null) {
      return;
    }
    if (method === "item/tool/requestUserInput") {
      await this.handleUserInputRequest(sessionId, client, id, message);
      return;
    }
    if (method === "item/commandExecution/requestApproval") {
      client.respond(id, { decision: "decline" });
      return;
    }
    if (method === "item/fileChange/requestApproval") {
      client.respond(id, { decision: "decline" });
      return;
    }
    client.respond(id, { error: "Unsupported Agent Port app-server request" });
  }

  private async handleUserInputRequest(
    sessionId: string,
    client: CodexAppServerClient,
    requestId: number,
    message: AppServerMessage
  ): Promise<void> {
    const active = this.activeTurns.get(sessionId);
    if (!active || active.finished || !this.messageBelongsToActiveTurn(message, active)) {
      client.respond(requestId, { answers: {} });
      return;
    }

    const params = asRecord(message.params);
    const questions = parseUserInputQuestions(params?.questions);
    const threadId = params ? readString(params, "threadId") : null;
    const turnId = params ? readString(params, "turnId") : null;
    active.threadId = threadId ?? active.threadId;
    active.turnId = turnId ?? active.turnId;
    active.pendingUserInput = {
      requestId,
      client,
      threadId,
      turnId,
      questions
    };

    const waitingInput: WaitingUserInput = {
      kind: "user_input",
      message: summarizeUserInputQuestions(questions),
      questions,
      requested_at: nowIso()
    };
    await this.sessionService.setWaitingUserInput(sessionId, waitingInput, null);
    const activity = await this.messageStore.upsertActivity(sessionId, active.assistantMessageId, {
      itemId: readString(params, "itemId") ?? `request-user-input:${requestId}`,
      kind: "thinking",
      title: "Waiting for user",
      content: waitingInput.message,
      status: "streaming"
    });
    if (activity) {
      await this.broadcastMessageUpdate(sessionId, active.assistantMessageId);
    }
    this.broadcastSessionStatus(sessionId);
  }

  private async handleThreadStatusChanged(
    sessionId: string,
    active: ActiveTurn,
    message: AppServerMessage
  ): Promise<void> {
    const params = asRecord(message.params);
    const threadId = params ? readString(params, "threadId") : null;
    if (threadId && active.threadId && threadId !== active.threadId) {
      return;
    }
    const status = asRecord(params?.status);
    const waitingOnUserInput =
      readString(status, "type") === "active" &&
      Array.isArray(status?.activeFlags) &&
      status.activeFlags.includes("waitingOnUserInput");
    if (waitingOnUserInput && !active.pendingUserInput) {
      await this.sessionService.setWaitingUserInput(
        sessionId,
        {
          kind: "user_input",
          message: "Codex is waiting for input.",
          questions: [],
          requested_at: nowIso()
        },
        null
      );
      this.broadcastSessionStatus(sessionId);
      return;
    }
    if (
      !waitingOnUserInput &&
      !active.pendingUserInput &&
      this.sessionService.get(sessionId).task_status === "WAITING_FOR_USER"
    ) {
      await this.sessionService.setTaskState(sessionId, "RUNNING", null);
      this.broadcastSessionStatus(sessionId);
    }
  }

  private async handleServerRequestResolved(
    sessionId: string,
    active: ActiveTurn,
    message: AppServerMessage
  ): Promise<void> {
    const params = asRecord(message.params);
    const requestId = params ? readNumber(params, "requestId") : null;
    if (requestId === null || active.pendingUserInput?.requestId !== requestId) {
      return;
    }
    active.pendingUserInput = null;
    if (this.sessionService.get(sessionId).task_status === "WAITING_FOR_USER") {
      await this.sessionService.setTaskState(sessionId, "RUNNING", null);
      this.broadcastSessionStatus(sessionId);
    }
  }

  private async handlePlanUpdated(sessionId: string, active: ActiveTurn, message: AppServerMessage): Promise<void> {
    const content = formatPlanUpdate(message);
    if (!content) {
      return;
    }
    const turnId = extractTurnIdFromAppServerMessage(message) ?? active.turnId ?? "current";
    await this.messageStore.upsertActivity(sessionId, active.assistantMessageId, {
      itemId: `turn-plan:${turnId}`,
      kind: "thinking",
      title: "Plan",
      content,
      status: "streaming"
    });
    await this.broadcastMessageUpdate(sessionId, active.assistantMessageId);
  }

  private async handleItemStarted(sessionId: string, active: ActiveTurn, message: AppServerMessage): Promise<void> {
    const item = extractItemFromAppServerMessage(message);
    if (!item) {
      return;
    }
    const itemType = readString(item, "type");
    if (itemType === "plan") {
      const itemId = readString(item, "id");
      if (!itemId) {
        return;
      }
      const activity = await this.messageStore.upsertActivity(sessionId, active.assistantMessageId, {
        itemId,
        kind: "thinking",
        title: "Plan",
        content: readString(item, "text") ?? "",
        status: "streaming",
        startedAt: extractStartedAtIso(message)
      });
      if (activity) {
        active.itemTargets.set(itemId, { target: "activity", activityId: activity.id });
        await this.broadcastMessageUpdate(sessionId, active.assistantMessageId);
      }
      return;
    }
    if (itemType !== "agentMessage") {
      return;
    }
    const itemId = readString(item, "id");
    if (!itemId) {
      return;
    }
    const phase = readString(item, "phase");
    const text = readString(item, "text") ?? "";
    if (phase === "commentary") {
      const activity = await this.messageStore.upsertActivity(sessionId, active.assistantMessageId, {
        itemId,
        kind: "thinking",
        title: "Thinking",
        content: text,
        status: "streaming",
        startedAt: extractStartedAtIso(message)
      });
      if (activity) {
        active.itemTargets.set(itemId, { target: "activity", activityId: activity.id });
        await this.broadcastMessageUpdate(sessionId, active.assistantMessageId);
      }
      return;
    }

    active.itemTargets.set(itemId, { target: "assistant" });
  }

  private async handleItemCompleted(sessionId: string, active: ActiveTurn, message: AppServerMessage): Promise<void> {
    const itemId = extractItemIdFromAppServerMessage(message);
    const target = itemId ? active.itemTargets.get(itemId) : null;
    const finalText = extractFinalAgentTextFromCodexEvent(message);
    if (target?.target === "activity") {
      if (finalText) {
        await this.messageStore.setActivityContent(sessionId, active.assistantMessageId, target.activityId, finalText);
      }
      await this.messageStore.completeActivity(sessionId, active.assistantMessageId, target.activityId, extractCompletedAtIso(message));
      await this.broadcastMessageUpdate(sessionId, active.assistantMessageId);
      return;
    }
    if (finalText) {
      await this.messageStore.setContent(sessionId, active.assistantMessageId, finalText);
      await this.broadcastMessageUpdate(sessionId, active.assistantMessageId);
    }
  }

  private messageBelongsToActiveTurn(message: AppServerMessage, active: ActiveTurn): boolean {
    const params = asRecord(message.params);
    const threadId = readString(params ?? message, "threadId");
    const turnId = readString(params ?? message, "turnId");
    return (!threadId || !active.threadId || threadId === active.threadId) && (!turnId || !active.turnId || turnId === active.turnId);
  }

  private async completeTurn(sessionId: string, active: ActiveTurn, message: AppServerMessage): Promise<void> {
    active.finished = true;
    this.activeTurns.delete(sessionId);
    active.client.close();
    await this.messageStore.setTurnCompleted(sessionId, active.assistantMessageId, {
      completedAt: extractTurnCompletedAtIso(message),
      durationMs: extractTurnDurationMs(message)
    });
    await this.messageStore.setStatus(sessionId, active.assistantMessageId, "complete");
    await this.sessionService.setTaskState(sessionId, "COMPLETED", null);
    await this.broadcastMessageUpdate(sessionId, active.assistantMessageId);
    this.broadcastSessionStatus(sessionId);
  }

  private async failTurn(sessionId: string, active: ActiveTurn, reason: string): Promise<void> {
    if (active.finished) {
      return;
    }
    active.finished = true;
    this.activeTurns.delete(sessionId);
    active.client.close();
    await this.messageStore.setStatus(sessionId, active.assistantMessageId, "error", reason);
    await this.sessionService.setTaskState(sessionId, "FAILED", null);
    await this.broadcastMessageUpdate(sessionId, active.assistantMessageId);
    this.broadcastSessionStatus(sessionId);
  }

  private async broadcastMessageUpdate(sessionId: string, messageId: string): Promise<void> {
    const message = (await this.messageStore.list(sessionId)).find((item) => item.id === messageId);
    if (!message) {
      return;
    }
    this.broadcaster.broadcast(sessionId, { type: "message_updated", sessionId, message });
  }

  private broadcastSessionStatus(sessionId: string): void {
    this.broadcaster.broadcast(sessionId, {
      type: "session_status",
      sessionId,
      session: this.sessionService.getPublic(sessionId)
    });
  }
}

type CodexInputItem = Record<string, unknown>;

function buildCodexInput(
  prompt: string,
  attachments: AttachmentRecord[],
  options: { planMode?: boolean } = {}
): CodexInputItem[] {
  const input: CodexInputItem[] = [];
  const promptText = options.planMode ? wrapPromptForManagedPlanMode(prompt) : prompt;
  const text = appendAttachmentManifest(promptText, attachments);
  if (text) {
    input.push({ type: "text", text, text_elements: [] });
  }
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      input.push({ type: "localImage", path: attachment.stored_path });
    }
  }
  for (const attachment of attachments.filter((item) => item.kind !== "image")) {
    input.push({
      type: "mention",
      name: attachment.original_name,
      path: attachment.stored_path
    });
  }
  return input;
}

export function wrapPromptForManagedPlanMode(prompt: string): string {
  return `${MANAGED_PLAN_MODE_PREFIX}
${prompt}`;
}

function appendAttachmentManifest(prompt: string, attachments: AttachmentRecord[]): string {
  if (!attachments.length) {
    return prompt;
  }
  const manifest = attachments
    .map(
      (attachment) =>
        `- ${attachment.original_name} (${attachment.mime_type}, ${attachment.size_bytes} bytes): ${attachment.stored_path}`
    )
    .join("\n");
  const attachmentText = `\n\nAttached local files:\n${manifest}\n\nUse the absolute paths above when reading these attachments.`;
  return prompt ? `${prompt}${attachmentText}` : attachmentText.trim();
}

function toPublicAttachment(attachment: AttachmentRecord): PublicAttachmentMetadata {
  const { stored_path: _storedPath, ...metadata } = attachment;
  return metadata;
}

function toPublicPermissionMode(mode: CodexPermissionModeConfig): PublicCodexPermissionMode {
  return {
    id: mode.id,
    label: mode.label,
    description: mode.description,
    highRisk: mode.highRisk === true
  };
}

function parseUserInputQuestions(value: unknown): WaitingUserInputQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => {
      const question = asRecord(item);
      if (!question) {
        return null;
      }
      const id = readString(question, "id") ?? `question-${index + 1}`;
      return {
        id,
        header: readString(question, "header") ?? "Codex",
        question: readString(question, "question") ?? "Codex is waiting for input.",
        isOther: readBoolean(question, "isOther"),
        isSecret: readBoolean(question, "isSecret"),
        options: parseUserInputOptions(question.options)
      };
    })
    .filter((item): item is WaitingUserInputQuestion => item !== null);
}

function parseUserInputOptions(value: unknown): WaitingUserInputQuestion["options"] {
  if (!Array.isArray(value)) {
    return null;
  }
  const options = value
    .map((item) => {
      const option = asRecord(item);
      const label = readString(option, "label");
      if (!label) {
        return null;
      }
      return {
        label,
        description: readString(option, "description") ?? ""
      };
    })
    .filter((item): item is NonNullable<WaitingUserInputQuestion["options"]>[number] => item !== null);
  return options.length ? options : null;
}

function summarizeUserInputQuestions(questions: WaitingUserInputQuestion[]): string {
  if (!questions.length) {
    return "Codex is waiting for input.";
  }
  return questions
    .map((question) => {
      const options = question.options?.map((option) => `- ${option.label}: ${option.description}`.trim()).join("\n");
      return options ? `${question.question}\n\n${options}` : question.question;
    })
    .join("\n\n");
}

function buildUserInputResponseAnswers(
  questions: WaitingUserInputQuestion[],
  text: string
): Record<string, { answers: string[] }> {
  if (!questions.length) {
    return {};
  }
  return Object.fromEntries(
    questions.map((question) => [question.id, { answers: [selectUserInputAnswer(question, text)] }])
  );
}

function selectUserInputAnswer(question: WaitingUserInputQuestion, text: string): string {
  const exactOption = question.options?.find((option) => option.label.toLowerCase() === text.toLowerCase());
  if (exactOption) {
    return exactOption.label;
  }
  if (isConfirmAnswer(text)) {
    const confirmOption = question.options?.find((option) =>
      /confirm|approve|accept|proceed|continue|implement|yes|ok/i.test(option.label)
    );
    if (confirmOption) {
      return confirmOption.label;
    }
  }
  return text;
}

function isConfirmAnswer(text: string): boolean {
  return /^(confirm|confirm plan|approve|approved|accept|yes|y|ok|proceed|continue|implement)$/i.test(text.trim());
}

function extractPlanDeltaFromAppServerMessage(message: AppServerMessage): string | null {
  if (message.method !== "item/plan/delta") {
    return null;
  }
  return readString(asRecord(message.params), "delta");
}

function formatPlanUpdate(message: AppServerMessage): string {
  const params = asRecord(message.params);
  if (!params) {
    return "";
  }
  const lines: string[] = [];
  const explanation = readString(params, "explanation");
  if (explanation) {
    lines.push(explanation);
  }
  const plan = Array.isArray(params.plan) ? params.plan : [];
  for (const rawStep of plan) {
    const step = asRecord(rawStep);
    const stepText = readString(step, "step");
    if (!stepText) {
      continue;
    }
    const status = readString(step, "status");
    const marker = status === "completed" ? "[x]" : status === "inProgress" ? "[-]" : "[ ]";
    lines.push(`- ${marker} ${stepText}`);
  }
  return lines.join("\n");
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function readString(record: JsonRecord | null, key: string): string | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  return typeof value === "string" && value ? value : null;
}

function readNumber(record: JsonRecord | null, key: string): number | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(record: JsonRecord | null, key: string): boolean {
  if (!record) {
    return false;
  }
  return record[key] === true;
}

function extractItemFromAppServerMessage(message: AppServerMessage): JsonRecord | null {
  return asRecord(asRecord(message.params)?.item) ?? asRecord(message.item);
}

function extractItemIdFromAppServerMessage(message: AppServerMessage): string | null {
  const params = asRecord(message.params);
  return readString(params, "itemId") ?? readString(extractItemFromAppServerMessage(message), "id");
}

function extractTurnIdFromAppServerMessage(message: AppServerMessage): string | null {
  const params = asRecord(message.params);
  return readString(params, "turnId") ?? readString(asRecord(params?.turn), "id") ?? readString(asRecord(message.turn), "id");
}

function extractStartedAtIso(message: AppServerMessage): string {
  const startedAtMs = readNumber(asRecord(message.params), "startedAtMs");
  return startedAtMs ? new Date(startedAtMs).toISOString() : nowIso();
}

function extractCompletedAtIso(message: AppServerMessage): string {
  const completedAtMs = readNumber(asRecord(message.params), "completedAtMs");
  return completedAtMs ? new Date(completedAtMs).toISOString() : nowIso();
}

function extractTurnCompletedAtIso(message: AppServerMessage): string {
  const turn = asRecord(asRecord(message.params)?.turn);
  const completedAtSeconds = readNumber(turn, "completedAt");
  return completedAtSeconds ? new Date(completedAtSeconds * 1000).toISOString() : nowIso();
}

function extractTurnDurationMs(message: AppServerMessage): number | null {
  const turn = asRecord(asRecord(message.params)?.turn);
  return readNumber(turn, "durationMs");
}

function readAppServerError(message: AppServerMessage): string {
  const params = asRecord(message.params);
  const error = asRecord(params?.error) ?? asRecord(message.error);
  return readString(error, "message") ?? readString(error, "code") ?? "Codex app-server reported an error";
}
