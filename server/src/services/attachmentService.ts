import fs from "node:fs/promises";
import path from "node:path";
import type { PublicAttachmentMetadata, AttachmentKind } from "../domain/attachmentTypes";
import { badRequest, notFound } from "../utils/httpErrors";
import { createId, nowIso } from "../utils/ids";
import { ensureDir, readJsonFile, writeJsonFile } from "../utils/fileStore";
import { validateSessionId } from "../utils/validation";

export interface AttachmentRecord extends PublicAttachmentMetadata {
  stored_path: string;
}

const MAX_ATTACHMENTS_PER_MESSAGE = 8;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const metadataFileName = "metadata.json";

const docMimeTypes = new Set([
  "application/json",
  "application/msword",
  "application/pdf",
  "application/rtf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/markdown",
  "text/plain"
]);

const mimeByExtension = new Map<string, string>([
  [".csv", "text/csv"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".gif", "image/gif"],
  [".heic", "image/heic"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".mov", "video/quicktime"],
  [".mp4", "video/mp4"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".rtf", "application/rtf"],
  [".txt", "text/plain"],
  [".webm", "video/webm"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
]);

export class AttachmentService {
  private readonly attachmentsDir: string;
  private readonly metadata = new Map<string, PublicAttachmentMetadata[]>();

  constructor(dataRoot: string) {
    this.attachmentsDir = path.join(dataRoot, "attachments");
  }

  async init(): Promise<void> {
    await ensureDir(this.attachmentsDir);
  }

  async create(sessionId: string, file: File): Promise<PublicAttachmentMetadata> {
    validateSessionId(sessionId);
    const originalName = normalizeOriginalName(file.name);
    const mimeType = normalizeMimeType(file.type, originalName);
    const kind = classifyAttachment(mimeType);
    enforceSize(file.size, kind);

    const id = createId();
    const storedName = `${id}${safeStoredExtension(originalName)}`;
    const sessionDir = this.sessionDir(sessionId);
    const storedPath = path.join(sessionDir, storedName);
    assertPathInsideDirectory(sessionDir, storedPath);

    await ensureDir(sessionDir);
    await fs.writeFile(storedPath, new Uint8Array(await file.arrayBuffer()));

    const now = nowIso();
    const metadata: PublicAttachmentMetadata = {
      id,
      session_id: sessionId,
      original_name: originalName,
      stored_name: storedName,
      mime_type: mimeType,
      size_bytes: file.size,
      kind,
      created_at: now
    };
    const attachments = await this.list(sessionId);
    attachments.push(metadata);
    await this.saveSessionMetadata(sessionId, attachments);
    return metadata;
  }

  async list(sessionId: string): Promise<PublicAttachmentMetadata[]> {
    validateSessionId(sessionId);
    if (!this.metadata.has(sessionId)) {
      const stored = await readJsonFile<PublicAttachmentMetadata[]>(this.metadataPath(sessionId));
      this.metadata.set(
        sessionId,
        Array.isArray(stored) ? stored.map(normalizeAttachmentMetadata).filter(isAttachmentMetadata) : []
      );
    }
    return [...(this.metadata.get(sessionId) ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async resolveForMessage(sessionId: string, attachmentIds: unknown): Promise<AttachmentRecord[]> {
    validateSessionId(sessionId);
    const ids = normalizeAttachmentIds(attachmentIds);
    if (!ids.length) {
      return [];
    }
    const attachments = await this.list(sessionId);
    const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
    const resolved: AttachmentRecord[] = [];
    for (const id of ids) {
      const metadata = byId.get(id);
      if (!metadata) {
        throw badRequest("Attachment not found for session");
      }
      const storedPath = path.join(this.sessionDir(sessionId), metadata.stored_name);
      assertPathInsideDirectory(this.sessionDir(sessionId), storedPath);
      resolved.push({ ...metadata, stored_path: storedPath });
    }
    return resolved;
  }

  async getContent(sessionId: string, attachmentId: string): Promise<AttachmentRecord> {
    validateSessionId(sessionId);
    const [metadata] = await this.resolveForMessage(sessionId, [attachmentId]);
    if (!metadata) {
      throw notFound("Attachment not found");
    }
    const exists = await Bun.file(metadata.stored_path).exists();
    if (!exists) {
      throw notFound("Attachment content not found");
    }
    return metadata;
  }

  async deleteForSession(sessionId: string): Promise<void> {
    validateSessionId(sessionId);
    this.metadata.delete(sessionId);
    await fs.rm(this.sessionDir(sessionId), { recursive: true, force: true });
  }

  private async saveSessionMetadata(sessionId: string, attachments: PublicAttachmentMetadata[]): Promise<void> {
    this.metadata.set(sessionId, attachments);
    await writeJsonFile(this.metadataPath(sessionId), attachments);
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.attachmentsDir, sessionId);
  }

  private metadataPath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), metadataFileName);
  }
}

export function normalizeAttachmentIds(value: unknown): string[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw badRequest("attachmentIds must be an array");
  }
  if (value.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw badRequest("Maximum 8 attachments per message");
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw badRequest("Invalid attachment id");
    }
    const id = item.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw badRequest("Invalid attachment id");
    }
    if (seen.has(id)) {
      throw badRequest("Duplicate attachment id");
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function normalizeOriginalName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ");
  const stripped = path.basename(normalized);
  if (
    !normalized ||
    stripped !== normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.includes("\0") ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    path.isAbsolute(normalized) ||
    /[\x00-\x1f\x7f]/.test(normalized)
  ) {
    throw badRequest("Invalid attachment filename");
  }
  return normalized.slice(0, 240);
}

function normalizeMimeType(mimeType: string, filename: string): string {
  const provided = mimeType.trim().toLowerCase();
  if (provided) {
    return provided;
  }
  return mimeByExtension.get(path.extname(filename).toLowerCase()) ?? "application/octet-stream";
}

function classifyAttachment(mimeType: string): AttachmentKind {
  if (mimeType === "image/svg+xml" || mimeType.startsWith("text/html")) {
    throw badRequest("Unsupported attachment type");
  }
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  if (mimeType.startsWith("text/") || docMimeTypes.has(mimeType)) {
    return "file";
  }
  throw badRequest("Unsupported attachment type");
}

function enforceSize(sizeBytes: number, kind: AttachmentKind): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw badRequest("Invalid attachment size");
  }
  const limit = kind === "video" ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
  if (sizeBytes > limit) {
    throw badRequest("Attachment is too large");
  }
}

function safeStoredExtension(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(extension) ? extension : "";
}

function normalizeAttachmentMetadata(value: PublicAttachmentMetadata): PublicAttachmentMetadata | null {
  const partial = value as Partial<PublicAttachmentMetadata>;
  if (
    typeof partial.id !== "string" ||
    typeof partial.session_id !== "string" ||
    typeof partial.original_name !== "string" ||
    typeof partial.stored_name !== "string" ||
    typeof partial.mime_type !== "string" ||
    typeof partial.size_bytes !== "number" ||
    typeof partial.created_at !== "string"
  ) {
    return null;
  }
  return {
    id: partial.id,
    session_id: partial.session_id,
    original_name: partial.original_name,
    stored_name: partial.stored_name,
    mime_type: partial.mime_type,
    size_bytes: partial.size_bytes,
    kind: partial.kind === "image" || partial.kind === "video" || partial.kind === "file" ? partial.kind : "file",
    created_at: partial.created_at
  };
}

function isAttachmentMetadata(value: PublicAttachmentMetadata | null): value is PublicAttachmentMetadata {
  return value !== null;
}

function assertPathInsideDirectory(rootDir: string, candidatePath: string): void {
  const root = path.resolve(rootDir);
  const candidate = path.resolve(candidatePath);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw badRequest("Invalid attachment path");
  }
}
