import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import { AttachmentService, normalizeAttachmentIds } from "../src/services/attachmentService";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("attachment service", () => {
  test("stores uploaded bytes under the app data attachment root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rcd-attachments-"));
    tempRoots.push(root);
    const sessionId = randomUUID();
    const service = new AttachmentService(root);
    await service.init();

    const attachment = await service.create(sessionId, new File(["hello"], "notes.txt", { type: "text/plain" }));
    const content = await service.getContent(sessionId, attachment.id);

    expect(attachment.original_name).toBe("notes.txt");
    expect(content.stored_path).toStartWith(path.join(root, "attachments", sessionId));
    expect(await fs.readFile(content.stored_path, "utf8")).toBe("hello");
    expect(content.stored_path).not.toContain("..");
  });

  test("rejects unsafe filenames and active inline content", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rcd-attachments-"));
    tempRoots.push(root);
    const sessionId = randomUUID();
    const service = new AttachmentService(root);
    await service.init();

    await expect(service.create(sessionId, new File(["x"], "../secret.txt", { type: "text/plain" }))).rejects.toThrow(
      "Invalid attachment filename"
    );
    await expect(service.create(sessionId, new File(["<svg />"], "icon.svg", { type: "image/svg+xml" }))).rejects.toThrow(
      "Unsupported attachment type"
    );
    await expect(service.create(sessionId, new File(["<html />"], "index.html", { type: "text/html" }))).rejects.toThrow(
      "Unsupported attachment type"
    );
  });

  test("validates attachment ids for message submission", () => {
    const id = randomUUID();
    expect(normalizeAttachmentIds([id])).toEqual([id]);
    expect(() => normalizeAttachmentIds(["../bad"])).toThrow("Invalid attachment id");
    expect(() => normalizeAttachmentIds([id, id])).toThrow("Duplicate attachment id");
    expect(() => normalizeAttachmentIds(Array.from({ length: 9 }, () => randomUUID()))).toThrow(
      "Maximum 8 attachments per message"
    );
  });
});
