import fs from "node:fs/promises";
import path from "node:path";
import { deleteFileIfExists, ensureDir } from "../utils/fileStore";

export class LogStore {
  private readonly logsDir: string;

  constructor(dataRoot: string, private readonly maxBytesPerSession: number) {
    this.logsDir = path.join(dataRoot, "logs");
  }

  async init(): Promise<void> {
    await ensureDir(this.logsDir);
  }

  async append(sessionId: string, chunk: string): Promise<void> {
    const filePath = this.logPath(sessionId);
    await ensureDir(path.dirname(filePath));
    await fs.appendFile(filePath, chunk, "utf8");
    const stat = await fs.stat(filePath);
    if (stat.size > this.maxBytesPerSession) {
      const raw = await fs.readFile(filePath);
      await fs.writeFile(filePath, raw.subarray(raw.length - this.maxBytesPerSession));
    }
  }

  async read(sessionId: string): Promise<string> {
    try {
      return await fs.readFile(this.logPath(sessionId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }

  async readTail(sessionId: string, maxBytes: number): Promise<string> {
    const filePath = this.logPath(sessionId);
    try {
      const stat = await fs.stat(filePath);
      const start = Math.max(0, stat.size - maxBytes);
      const file = await fs.open(filePath, "r");
      try {
        const buffer = Buffer.alloc(stat.size - start);
        await file.read(buffer, 0, buffer.length, start);
        return buffer.toString("utf8");
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }

  async delete(sessionId: string): Promise<void> {
    await deleteFileIfExists(this.logPath(sessionId));
  }

  private logPath(sessionId: string): string {
    return path.join(this.logsDir, `${sessionId}.log`);
  }
}
