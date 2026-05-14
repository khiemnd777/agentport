import { describe, expect, test } from "bun:test";
import { CodexAppServerHost } from "../src/services/codexAppServerHost";
import {
  buildCodexAppServerCommand,
  type CodexAppServerConnection,
  type CodexAppServerLaunchMode
} from "../src/services/codexAppServerClient";

describe("codex app-server host", () => {
  test("builds standalone and desktop proxy launch commands", () => {
    expect(buildCodexAppServerCommand("codex", ["--enable", "x"], "standalone")).toEqual([
      "codex",
      "--enable",
      "x",
      "app-server",
      "--listen",
      "stdio://"
    ]);
    expect(buildCodexAppServerCommand("codex", [], "desktop_proxy")).toEqual(["codex", "app-server", "proxy"]);
  });

  test("prefers desktop proxy and falls back to standalone when proxy is unavailable", async () => {
    const attempts: CodexAppServerLaunchMode[] = [];
    const host = new CodexAppServerHost("codex", [], {
      clientFactory: (launchMode) => {
        attempts.push(launchMode);
        return new FakeAppServerConnection(launchMode, { failInitialize: launchMode === "desktop_proxy" });
      }
    });

    const result = await host.request<{ launchMode: CodexAppServerLaunchMode }>("thread/list", {});

    expect(result.launchMode).toBe("standalone");
    expect(host.getConnectionMode()).toBe("standalone");
    expect(attempts).toEqual(["desktop_proxy", "standalone"]);
  });

  test("upgrades an existing standalone connection to desktop proxy before a new mobile turn", async () => {
    let proxyAvailable = false;
    const connections: FakeAppServerConnection[] = [];
    const host = new CodexAppServerHost("codex", [], {
      clientFactory: (launchMode) => {
        const connection = new FakeAppServerConnection(launchMode, {
          failInitialize: launchMode === "desktop_proxy" && !proxyAvailable
        });
        connections.push(connection);
        return connection;
      }
    });

    await host.request("thread/list", {});
    const standalone = connections.find((connection) => connection.launchMode === "standalone");
    proxyAvailable = true;

    await expect(host.preferDesktopConnection()).resolves.toBe(true);

    expect(host.getConnectionMode()).toBe("desktop_proxy");
    expect(standalone?.closed).toBe(true);
  });

  test("can be configured to use standalone only", async () => {
    const attempts: CodexAppServerLaunchMode[] = [];
    const host = new CodexAppServerHost("codex", [], {
      preferDesktopProxy: false,
      clientFactory: (launchMode) => {
        attempts.push(launchMode);
        return new FakeAppServerConnection(launchMode);
      }
    });

    await host.request("thread/list", {});

    expect(attempts).toEqual(["standalone"]);
    expect(host.getConnectionMode()).toBe("standalone");
  });
});

class FakeAppServerConnection implements CodexAppServerConnection {
  closed = false;

  constructor(
    readonly launchMode: CodexAppServerLaunchMode,
    private readonly options: { failInitialize?: boolean } = {}
  ) {}

  async initialize(): Promise<void> {
    if (this.options.failInitialize) {
      throw new Error(`${this.launchMode} unavailable`);
    }
  }

  async request<T = unknown>(): Promise<T> {
    return { launchMode: this.launchMode } as T;
  }

  notify(): void {
    return;
  }

  respond(): void {
    return;
  }

  close(): void {
    this.closed = true;
  }
}
