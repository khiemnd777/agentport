import { Hono } from "hono";
import type {
  BrowserPushSubscription,
  NotificationEventKind
} from "../domain/notificationTypes";
import { notificationEventKinds, toPublicPushSubscription } from "../domain/notificationTypes";
import type { PushNotificationService } from "../services/pushNotificationService";
import { badRequest } from "../utils/httpErrors";
import { parseJsonObject } from "../utils/validation";

const allowedPushEndpointHosts = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "updates-autopush.stage.mozaws.net"
];

export function notificationRoutes(notificationService: PushNotificationService): Hono {
  const app = new Hono();

  app.get("/notifications/status", (c) => c.json(notificationService.status()));

  app.post("/notifications/subscriptions", async (c) => {
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    const subscription = validateBrowserPushSubscription(body.subscription);
    const events = validateNotificationEvents(body.events);
    const record = await notificationService.upsertSubscription(
      subscription,
      events,
      c.req.header("user-agent") ?? null
    );
    return c.json({ subscription: toPublicPushSubscription(record) }, 201);
  });

  app.delete("/notifications/subscriptions", async (c) => {
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    const endpoint = validatePushEndpoint(body.endpoint);
    const deleted = await notificationService.deleteSubscription(endpoint);
    return c.json({ ok: true, deleted });
  });

  app.post("/notifications/test", async (c) => {
    const body = parseJsonObject(await c.req.json().catch(() => ({})));
    const endpoint = body.endpoint == null ? undefined : validatePushEndpoint(body.endpoint);
    const result = await notificationService.sendTest(endpoint);
    return c.json({ ok: true, ...result });
  });

  return app;
}

export function validateBrowserPushSubscription(value: unknown): BrowserPushSubscription {
  const subscription = requireJsonObject(value, "Push subscription must be an object");
  const keys = requireJsonObject(subscription.keys, "Push subscription keys must be an object");
  return {
    endpoint: validatePushEndpoint(subscription.endpoint),
    expirationTime: validateExpirationTime(subscription.expirationTime),
    keys: {
      p256dh: validateSubscriptionKey(keys.p256dh, "p256dh"),
      auth: validateSubscriptionKey(keys.auth, "auth")
    }
  };
}

export function validateNotificationEvents(value: unknown): NotificationEventKind[] {
  if (value == null) {
    return [...notificationEventKinds];
  }
  if (!Array.isArray(value)) {
    throw badRequest("Notification events must be an array");
  }
  const allowed = new Set(notificationEventKinds);
  const events = value.map((event) => {
    if (typeof event !== "string" || !allowed.has(event as NotificationEventKind)) {
      throw badRequest("Unsupported notification event");
    }
    return event as NotificationEventKind;
  });
  if (!events.length) {
    throw badRequest("At least one notification event is required");
  }
  return [...new Set(events)];
}

export function validatePushEndpoint(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) {
    throw badRequest("Invalid push endpoint");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badRequest("Invalid push endpoint");
  }
  if (url.protocol !== "https:" || !isAllowedPushEndpointHost(url.hostname)) {
    throw badRequest("Unsupported push endpoint");
  }
  return url.toString();
}

function validateExpirationTime(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw badRequest("Invalid push subscription expiration");
  }
  return value;
}

function validateSubscriptionKey(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    value.length > 512 ||
    !/^[A-Za-z0-9_-]+={0,2}$/.test(value)
  ) {
    throw badRequest(`Invalid push subscription ${name} key`);
  }
  return value;
}

function isAllowedPushEndpointHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "push.apple.com" || host.endsWith(".push.apple.com") || allowedPushEndpointHosts.includes(host);
}

function requireJsonObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(message);
  }
  return value as Record<string, unknown>;
}
