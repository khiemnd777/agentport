type JsonRecord = Record<string, unknown>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export type AppServerMessage = JsonRecord;

export type CodexAppServerLaunchMode = "desktop_proxy" | "standalone";

export interface CodexAppServerConnection {
  readonly launchMode: CodexAppServerLaunchMode;
  initialize(): Promise<void>;
  request<T = unknown>(method: string, params: unknown): Promise<T>;
  notify(method: string, params?: unknown): void;
  respond(id: number, result: unknown): void;
  close(): void;
}

export class CodexAppServerClient implements CodexAppServerConnection {
  private readonly process: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private closed = false;

  constructor(
    command: string,
    args: string[],
    private readonly onNotification: (message: AppServerMessage) => void,
    private readonly onServerRequest: (client: CodexAppServerClient, message: AppServerMessage) => void,
    private readonly onExit?: (error: Error) => void,
    readonly launchMode: CodexAppServerLaunchMode = "standalone"
  ) {
    this.process = Bun.spawn(buildCodexAppServerCommand(command, args, launchMode), {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    });
    void this.readStdout();
    void this.readStderr();
    void this.process.exited.then((exitCode) => this.handleExit(exitCode));
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "agent-port", title: "Agent Port", version: "0" },
      capabilities: { experimentalApi: true, optOutNotificationMethods: [] }
    });
    this.notify("initialized");
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("Codex app-server is closed"));
    }
    const id = this.nextRequestId++;
    const payload = { id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      });
      this.write(payload);
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) {
      return;
    }
    this.write(params === undefined ? { method } : { method, params });
  }

  respond(id: number, result: unknown): void {
    if (this.closed) {
      return;
    }
    this.write({ id, result });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.process.kill();
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Codex app-server was closed"));
    }
    this.pending.clear();
  }

  private write(payload: unknown): void {
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private async readStdout(): Promise<void> {
    const reader = this.process.stdout.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        this.stdoutBuffer += decoder.decode(value, { stream: true });
        const lines = this.stdoutBuffer.split(/\r?\n/);
        this.stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          this.handleLine(line);
        }
      }
      if (this.stdoutBuffer.trim()) {
        this.handleLine(this.stdoutBuffer);
      }
    } catch (error) {
      this.rejectAll(error as Error);
    }
  }

  private async readStderr(): Promise<void> {
    const reader = this.process.stderr.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      this.stderrBuffer = `${this.stderrBuffer}${decoder.decode(value, { stream: true })}`.slice(-8000);
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    const record = asRecord(message);
    if (!record) {
      return;
    }

    const id = typeof record.id === "number" ? record.id : null;
    if (id !== null && ("result" in record || "error" in record)) {
      this.resolveResponse(id, record);
      return;
    }

    if (typeof record.method === "string") {
      if (id !== null) {
        this.onServerRequest(this, record);
        return;
      }
      this.onNotification(record);
    }
  }

  private resolveResponse(id: number, record: JsonRecord): void {
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    const error = asRecord(record.error);
    if (error) {
      pending.reject(new Error(readString(error, "message") ?? `Codex app-server request ${id} failed`));
      return;
    }
    pending.resolve(record.result);
  }

  private handleExit(exitCode: number): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const stderr = this.stderrBuffer.trim();
    const message = stderr || `Codex app-server exited with code ${exitCode}`;
    const error = new Error(message);
    this.rejectAll(error);
    this.onExit?.(error);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function buildCodexAppServerCommand(
  command: string,
  args: string[],
  launchMode: CodexAppServerLaunchMode
): string[] {
  if (launchMode === "desktop_proxy") {
    return [command, ...args, "app-server", "proxy"];
  }
  return [command, ...args, "app-server", "--listen", "stdio://"];
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function readString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value ? value : null;
}
