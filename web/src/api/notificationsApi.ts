import { apiFetch } from "./client";

export type NotificationEventKind = "task_completed" | "task_failed" | "user_input_requested";

export interface NotificationStatus {
  configured: boolean;
  publicKey: string | null;
  subscriptionCount: number;
  events: NotificationEventKind[];
}

export interface PublicPushSubscription {
  id: string;
  events: NotificationEventKind[];
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface BrowserPushSubscriptionJson {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
}

export async function getNotificationStatus(): Promise<NotificationStatus> {
  return apiFetch<NotificationStatus>("/api/notifications/status");
}

export async function savePushSubscription(
  subscription: BrowserPushSubscriptionJson,
  events: NotificationEventKind[]
): Promise<{ subscription: PublicPushSubscription }> {
  return apiFetch<{ subscription: PublicPushSubscription }>("/api/notifications/subscriptions", {
    method: "POST",
    body: JSON.stringify({ subscription, events })
  });
}

export async function deletePushSubscription(endpoint: string): Promise<{ ok: true; deleted: boolean }> {
  return apiFetch<{ ok: true; deleted: boolean }>("/api/notifications/subscriptions", {
    method: "DELETE",
    body: JSON.stringify({ endpoint })
  });
}

export async function sendTestNotification(endpoint?: string): Promise<{ ok: true; sent: number; failed: number }> {
  return apiFetch<{ ok: true; sent: number; failed: number }>("/api/notifications/test", {
    method: "POST",
    body: JSON.stringify({ endpoint })
  });
}
