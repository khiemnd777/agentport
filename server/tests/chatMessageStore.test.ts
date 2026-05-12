import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { ChatMessageStore } from "../src/services/chatMessageStore";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("chat message store", () => {
  test("stores assistant activity groups and turn duration", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rcd-chat-store-"));
    tempRoots.push(root);
    const store = new ChatMessageStore(root);
    await store.init();

    const sessionId = randomUUID();
    const message = await store.create({
      sessionId,
      role: "assistant",
      content: "",
      status: "streaming"
    });

    await store.setTurnStarted(sessionId, message.id, "2026-05-11T10:00:00.000Z");
    const activity = await store.upsertActivity(sessionId, message.id, {
      itemId: "item-thinking",
      kind: "thinking",
      title: "Thinking",
      content: "Toi se kiem tra",
      status: "streaming",
      startedAt: "2026-05-11T10:00:01.000Z"
    });
    expect(activity?.title).toBe("Thinking");
    await store.appendActivityContent(sessionId, message.id, activity!.id, " commit moi nhat");
    await store.completeActivity(sessionId, message.id, activity!.id, "2026-05-11T10:00:05.000Z");
    await store.setTurnCompleted(sessionId, message.id, {
      completedAt: "2026-05-11T10:00:27.000Z",
      durationMs: 27_000
    });

    const [stored] = await store.list(sessionId);
    expect(stored.duration_ms).toBe(27_000);
    expect(stored.activities).toHaveLength(1);
    expect(stored.activities[0].content).toBe("Toi se kiem tra commit moi nhat");
    expect(stored.activities[0].status).toBe("complete");
  });

  test("persists attachments and normalizes legacy messages without attachments", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rcd-chat-store-"));
    tempRoots.push(root);
    const store = new ChatMessageStore(root);
    await store.init();

    const sessionId = randomUUID();
    const attachment = {
      id: randomUUID(),
      session_id: sessionId,
      original_name: "photo.png",
      stored_name: `${randomUUID()}.png`,
      mime_type: "image/png",
      size_bytes: 12,
      kind: "image" as const,
      created_at: "2026-05-11T10:00:00.000Z"
    };
    await store.create({
      sessionId,
      role: "user",
      content: "inspect this",
      status: "complete",
      attachments: [attachment]
    });

    const reloaded = new ChatMessageStore(root);
    await reloaded.init();
    const [stored] = await reloaded.list(sessionId);
    expect(stored.attachments).toEqual([attachment]);

    const legacySessionId = randomUUID();
    await fs.mkdir(path.join(root, "messages"), { recursive: true });
    await fs.writeFile(
      path.join(root, "messages", `${legacySessionId}.json`),
      JSON.stringify([
        {
          id: randomUUID(),
          session_id: legacySessionId,
          role: "user",
          content: "legacy",
          status: "complete",
          turn_id: null,
          created_at: "2026-05-11T10:00:00.000Z",
          updated_at: "2026-05-11T10:00:00.000Z",
          error: null
        }
      ]),
      "utf8"
    );

    const [legacy] = await reloaded.list(legacySessionId);
    expect(legacy.attachments).toEqual([]);
    expect(legacy.activities).toEqual([]);
  });
});
