import crypto from "node:crypto";
import path from "node:path";
import type {
  BrowserPushSubscription,
  NotificationEventKind,
  PushSubscriptionRecord
} from "../domain/notificationTypes";
import { notificationEventKinds } from "../domain/notificationTypes";
import { ensureDir, readJsonFile, writeJsonFile } from "../utils/fileStore";
import { nowIso } from "../utils/ids";

interface PushSubscriptionFile {
  subscriptions: PushSubscriptionRecord[];
}

export class PushSubscriptionStore {
  private readonly notificationsDir: string;
  private readonly filePath: string;
  private subscriptions = new Map<string, PushSubscriptionRecord>();

  constructor(dataRoot: string) {
    this.notificationsDir = path.join(dataRoot, "notifications");
    this.filePath = path.join(this.notificationsDir, "subscriptions.json");
  }

  async init(): Promise<void> {
    await ensureDir(this.notificationsDir);
    const file = await readJsonFile<PushSubscriptionFile>(this.filePath);
    for (const record of file?.subscriptions ?? []) {
      this.subscriptions.set(record.id, normalizeRecord(record));
    }
  }

  list(): PushSubscriptionRecord[] {
    return [...this.subscriptions.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  count(): number {
    return this.subscriptions.size;
  }

  async upsert(
    subscription: BrowserPushSubscription,
    events: NotificationEventKind[],
    userAgent: string | null
  ): Promise<PushSubscriptionRecord> {
    const id = subscriptionId(subscription.endpoint);
    const now = nowIso();
    const existing = this.subscriptions.get(id);
    const record: PushSubscriptionRecord = {
      id,
      endpoint: subscription.endpoint,
      subscription,
      events: events.length ? dedupeEvents(events) : [...notificationEventKinds],
      user_agent: normalizeUserAgent(userAgent),
      created_at: existing?.created_at ?? now,
      updated_at: now,
      last_seen_at: now,
      failure_count: existing?.failure_count ?? 0,
      failed_at: existing?.failed_at ?? null
    };
    this.subscriptions.set(id, record);
    await this.save();
    return record;
  }

  async deleteByEndpoint(endpoint: string): Promise<boolean> {
    const deleted = this.subscriptions.delete(subscriptionId(endpoint));
    if (deleted) {
      await this.save();
    }
    return deleted;
  }

  async markFailure(endpoint: string): Promise<void> {
    const id = subscriptionId(endpoint);
    const record = this.subscriptions.get(id);
    if (!record) {
      return;
    }
    record.failure_count += 1;
    record.failed_at = nowIso();
    record.updated_at = record.failed_at;
    await this.save();
  }

  private async save(): Promise<void> {
    await writeJsonFile<PushSubscriptionFile>(this.filePath, {
      subscriptions: this.list()
    });
  }
}

export function subscriptionId(endpoint: string): string {
  return crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 24);
}

function normalizeRecord(record: PushSubscriptionRecord): PushSubscriptionRecord {
  return {
    ...record,
    events: dedupeEvents(record.events),
    user_agent: normalizeUserAgent(record.user_agent),
    failure_count: Number.isFinite(record.failure_count) ? record.failure_count : 0,
    failed_at: record.failed_at ?? null
  };
}

function dedupeEvents(events: NotificationEventKind[]): NotificationEventKind[] {
  const allowed = new Set(notificationEventKinds);
  const unique = new Set(events.filter((event) => allowed.has(event)));
  return unique.size ? [...unique] : [...notificationEventKinds];
}

function normalizeUserAgent(userAgent: string | null): string | null {
  const normalized = userAgent?.trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 240);
}
