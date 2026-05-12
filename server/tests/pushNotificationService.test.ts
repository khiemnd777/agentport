import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import type { BrowserPushSubscription, WebPushPayload } from "../src/domain/notificationTypes";
import type { Task } from "../src/domain/taskTypes";
import { validateBrowserPushSubscription, validateNotificationEvents } from "../src/routes/notificationRoutes";
import { PushNotificationService, type PushSender } from "../src/services/pushNotificationService";

const validSubscription: BrowserPushSubscription = {
  endpoint: "https://web.push.apple.com/QMTEST",
  expirationTime: null,
  keys: {
    p256dh: "BMz4T2xk8T8pQ9uN4T2xk8T8pQ9uN4T2xk8T8pQ9uN4T2xk8T8pQ9uN4T2xk8T8pQ9uN4",
    auth: "test_auth_key_0000"
  }
};

describe("push notification validation", () => {
  test("accepts Apple Web Push subscriptions", () => {
    expect(validateBrowserPushSubscription(validSubscription).endpoint).toBe("https://web.push.apple.com/QMTEST");
  });

  test("rejects non-push endpoints so the server cannot be used as a URL poster", () => {
    expect(() =>
      validateBrowserPushSubscription({
        ...validSubscription,
        endpoint: "https://127.0.0.1:8787/internal"
      })
    ).toThrow("Unsupported push endpoint");
  });

  test("requires at least one notification event", () => {
    expect(validateNotificationEvents(["task_completed"])).toEqual(["task_completed"]);
    expect(() => validateNotificationEvents([])).toThrow("At least one notification event");
  });
});

describe("push notification service", () => {
  test("sends only subscribed task events", async () => {
    await withTempDataRoot(async (dataRoot) => {
      const sender = new FakePushSender();
      const service = new PushNotificationService(dataRoot, sender);
      await service.init();
      await service.upsertSubscription(validSubscription, ["task_completed"], "Unit Test");

      await service.notifyTaskTransition(taskFixture({ status: "WAITING_FOR_USER" }), "WAITING_FOR_USER");
      expect(sender.payloads).toHaveLength(0);

      await service.notifyTaskTransition(taskFixture({ status: "COMPLETED" }), "COMPLETED");
      expect(sender.payloads).toHaveLength(1);
      expect(sender.payloads[0].event).toBe("task_completed");
      expect(sender.payloads[0].body).toBe("Ship push alerts");
    });
  });

  test("removes stale subscriptions after push service 410 responses", async () => {
    await withTempDataRoot(async (dataRoot) => {
      const sender = new FakePushSender(410);
      const service = new PushNotificationService(dataRoot, sender);
      await service.init();
      await service.upsertSubscription(validSubscription, ["task_completed"], null);

      const result = await service.sendTest(validSubscription.endpoint);
      expect(result).toEqual({ sent: 0, failed: 1 });
      expect(service.status().subscriptionCount).toBe(0);
    });
  });
});

class FakePushSender implements PushSender {
  configured = true;
  publicKey = "fake-public-key";
  readonly payloads: WebPushPayload[] = [];

  constructor(private readonly statusCode?: number) {}

  async send(_subscription: BrowserPushSubscription, payload: WebPushPayload): Promise<void> {
    if (this.statusCode) {
      throw Object.assign(new Error("push failed"), { statusCode: this.statusCode });
    }
    this.payloads.push(payload);
  }
}

function taskFixture(overrides: Partial<Task> = {}): Task {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    session_id: "22222222-2222-4222-8222-222222222222",
    repo_key: "noah",
    title: "Ship push alerts",
    prompt: "notify me",
    wrapped_prompt: "notify me",
    source: "desktop_web",
    control_mode: "web_managed",
    status: "RUNNING",
    user_input_channel: "web_ui",
    created_at: "2026-05-12T00:00:00.000Z",
    updated_at: "2026-05-12T00:00:00.000Z",
    started_at: "2026-05-12T00:00:01.000Z",
    finished_at: null,
    last_error: null,
    ...overrides
  };
}

async function withTempDataRoot(run: (dataRoot: string) => Promise<void>): Promise<void> {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-port-push-"));
  try {
    await run(dataRoot);
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
}
