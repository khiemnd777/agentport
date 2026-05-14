import * as pty from "node-pty";
import { buildExpectBridgeScript, buildExpectResizeMarker } from "./expectBridge";
import { createPtyEnv } from "./ptyEnv";

export interface CodexPtySessionOptions {
  sessionId: string;
  command: string;
  args: string[];
  cwd: string;
  onData: (chunk: string) => void;
  onExit: (exitCode: number, signal?: number) => void;
}

export class CodexPtySession {
  private nodePtyProcess: pty.IPty | null = null;
  private fallbackProcess: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private fallbackStdin: Bun.FileSink | null = null;
  private cols = 120;
  private rows = 40;

  constructor(private readonly options: CodexPtySessionOptions) {}

  start(): void {
    if (this.nodePtyProcess || this.fallbackProcess) {
      return;
    }
    try {
      this.nodePtyProcess = pty.spawn(this.options.command, this.options.args, {
        name: "xterm-256color",
        cols: this.cols,
        rows: this.rows,
        cwd: this.options.cwd,
        env: createPtyEnv()
      });
      this.nodePtyProcess.onData((chunk) => this.options.onData(chunk));
      this.nodePtyProcess.onExit(({ exitCode, signal }) => this.options.onExit(exitCode, signal));
    } catch (error) {
      this.nodePtyProcess = null;
      this.options.onData(
        `\r\n[Agent Port] node-pty failed under Bun (${(error as Error).message}). Falling back to /usr/bin/expect PTY bridge.\r\n`
      );
      this.startExpectFallback();
    }
  }

  write(input: string): void {
    if (this.nodePtyProcess) {
      this.nodePtyProcess.write(input);
      return;
    }
    this.fallbackStdin?.write(input);
    void this.fallbackStdin?.flush();
  }

  resize(cols: number, rows: number): void {
    this.cols = Math.max(20, Math.floor(cols));
    this.rows = Math.max(5, Math.floor(rows));
    if (this.nodePtyProcess) {
      this.nodePtyProcess.resize(this.cols, this.rows);
      return;
    }
    if (this.fallbackStdin) {
      this.fallbackStdin.write(buildExpectResizeMarker(this.cols, this.rows));
      void this.fallbackStdin.flush();
    }
  }

  close(): void {
    this.nodePtyProcess?.kill();
    this.nodePtyProcess = null;
    this.fallbackProcess?.kill();
    this.fallbackProcess = null;
    void Promise.resolve(this.fallbackStdin?.end()).catch(() => undefined);
    this.fallbackStdin = null;
  }

  private startExpectFallback(): void {
    this.fallbackProcess = Bun.spawn(["/usr/bin/expect", "-c", buildExpectBridgeScript([this.options.command, ...this.options.args], this.cols, this.rows)], {
      cwd: this.options.cwd,
      env: createPtyEnv(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    });
    this.fallbackStdin = this.fallbackProcess.stdin;
    this.readStream(this.fallbackProcess.stdout);
    this.readStream(this.fallbackProcess.stderr);
    void this.fallbackProcess.exited.then((exitCode) => {
      this.fallbackProcess = null;
      this.fallbackStdin = null;
      this.options.onExit(exitCode);
    });
  }

  private readStream(stream: ReadableStream<Uint8Array>): void {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        this.options.onData(decoder.decode(value, { stream: true }));
      }
    };
    void pump().catch((error) => {
      this.options.onData(`\r\n[Agent Port] PTY stream error: ${(error as Error).message}\r\n`);
    });
  }
}
