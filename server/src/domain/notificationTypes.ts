export type NotificationEventKind = "task_completed" | "task_failed" | "user_input_requested";

export const notificationEventKinds: NotificationEventKind[] = [
  "task_completed",
  "task_failed",
  "user_input_requested"
];

export interface BrowserPushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  subscription: BrowserPushSubscription;
  events: NotificationEventKind[];
  user_agent: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  failure_count: number;
  failed_at: string | null;
}

export interface PublicPushSubscription {
  id: string;
  events: NotificationEventKind[];
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface NotificationStatus {
  configured: boolean;
  publicKey: string | null;
  subscriptionCount: number;
  events: NotificationEventKind[];
}

export interface WebPushPayload {
  event: NotificationEventKind;
  title: string;
  body: string;
  url: string;
  tag: string;
  taskId: string;
  sessionId: string;
  timestamp: string;
}

export function toPublicPushSubscription(record: PushSubscriptionRecord): PublicPushSubscription {
  return {
    id: record.id,
    events: record.events,
    created_at: record.created_at,
    updated_at: record.updated_at,
    last_seen_at: record.last_seen_at
  };
}
