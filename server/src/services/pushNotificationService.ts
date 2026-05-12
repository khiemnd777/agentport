import webPush from "web-push";
import type { Task, TaskStatus } from "../domain/taskTypes";
import type {
  BrowserPushSubscription,
  NotificationEventKind,
  NotificationStatus,
  PushSubscriptionRecord,
  WebPushPayload
} from "../domain/notificationTypes";
import { notificationEventKinds } from "../domain/notificationTypes";
import { conflict } from "../utils/httpErrors";
import { nowIso } from "../utils/ids";
import { PushSubscriptionStore } from "./pushSubscriptionStore";

const defaultVapidSubject = "mailto:agent-port@localhost";
const staleSubscriptionStatusCodes = new Set([404, 410]);

export interface PushSender {
  configured: boolean;
  publicKey: string | null;
  send(subscription: BrowserPushSubscription, payload: WebPushPayload): Promise<void>;
}

export class WebPushSender implements PushSender {
  readonly configured: boolean;
  readonly publicKey: string | null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const publicKey = readEnv(env.RCD_PUSH_VAPID_PUBLIC_KEY);
    const privateKey = readEnv(env.RCD_PUSH_VAPID_PRIVATE_KEY);
    const subject = readEnv(env.RCD_PUSH_VAPID_SUBJECT) ?? defaultVapidSubject;
    this.publicKey = publicKey;
    this.configured = Boolean(publicKey && privateKey);
    if (publicKey && privateKey) {
      webPush.setVapidDetails(subject, publicKey, privateKey);
    }
  }

  async send(subscription: BrowserPushSubscription, payload: WebPushPayload): Promise<void> {
    if (!this.configured) {
      throw conflict("Push notifications are not configured");
    }
    await webPush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 60 * 60,
      urgency: payload.event === "user_input_requested" ? "high" : "normal"
    });
  }
}

export class PushNotificationService {
  private readonly store: PushSubscriptionStore;

  constructor(
    dataRoot: string,
    private readonly sender: PushSender = new WebPushSender()
  ) {
    this.store = new PushSubscriptionStore(dataRoot);
  }

  async init(): Promise<void> {
    await this.store.init();
  }

  status(): NotificationStatus {
    return {
      configured: this.sender.configured,
      publicKey: this.sender.publicKey,
      subscriptionCount: this.store.count(),
      events: notificationEventKinds
    };
  }

  async upsertSubscription(
    subscription: BrowserPushSubscription,
    events: NotificationEventKind[],
    userAgent: string | null
  ): Promise<PushSubscriptionRecord> {
    this.assertConfigured();
    return this.store.upsert(subscription, events, userAgent);
  }

  async deleteSubscription(endpoint: string): Promise<boolean> {
    return this.store.deleteByEndpoint(endpoint);
  }

  async sendTest(endpoint?: string): Promise<{ sent: number; failed: number }> {
    this.assertConfigured();
    const payload: WebPushPayload = {
      event: "task_completed",
      title: "Agent Port notification test",
      body: "Task alerts are enabled on this device.",
      url: "/",
      tag: `agent-port-test-${Date.now()}`,
      taskId: "test",
      sessionId: "test",
      timestamp: nowIso()
    };
    return this.sendPayload("task_completed", payload, endpoint);
  }

  async notifyTaskTransition(task: Task, status: TaskStatus): Promise<void> {
    const event = eventForStatus(status);
    if (!event || !this.sender.configured) {
      return;
    }
    const payload = payloadForTask(task, event);
    await this.sendPayload(event, payload);
  }

  private async sendPayload(
    event: NotificationEventKind,
    payload: WebPushPayload,
    endpoint?: string
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    const targets = this.store
      .list()
      .filter((record) => record.events.includes(event))
      .filter((record) => !endpoint || record.endpoint === endpoint);

    for (const record of targets) {
      try {
        await this.sender.send(record.subscription, payload);
        sent += 1;
      } catch (error) {
        failed += 1;
        if (staleSubscriptionStatusCodes.has(statusCodeFromError(error))) {
          await this.store.deleteByEndpoint(record.endpoint);
        } else {
          await this.store.markFailure(record.endpoint);
        }
      }
    }
    return { sent, failed };
  }

  private assertConfigured(): void {
    if (!this.sender.configured) {
      throw conflict("Push notifications are not configured");
    }
  }
}

function eventForStatus(status: TaskStatus): NotificationEventKind | null {
  switch (status) {
    case "COMPLETED":
      return "task_completed";
    case "FAILED":
      return "task_failed";
    case "WAITING_FOR_USER":
      return "user_input_requested";
    default:
      return null;
  }
}

function payloadForTask(task: Task, event: NotificationEventKind): WebPushPayload {
  const title = titleForEvent(event);
  const body = bodyForTask(task, event);
  return {
    event,
    title,
    body,
    url: "/",
    tag: `agent-port-${task.id}-${event}`,
    taskId: task.id,
    sessionId: task.session_id,
    timestamp: nowIso()
  };
}

function titleForEvent(event: NotificationEventKind): string {
  switch (event) {
    case "task_completed":
      return "Agent Port task completed";
    case "task_failed":
      return "Agent Port task failed";
    case "user_input_requested":
      return "Agent Port needs input";
  }
}

function bodyForTask(task: Task, event: NotificationEventKind): string {
  const title = task.title.trim() || "Untitled task";
  if (event === "task_failed" && task.last_error) {
    return `${title}: ${sanitizeNotificationText(task.last_error)}`;
  }
  return title;
}

function sanitizeNotificationText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function statusCodeFromError(error: unknown): number {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : 0;
}

function readEnv(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}
