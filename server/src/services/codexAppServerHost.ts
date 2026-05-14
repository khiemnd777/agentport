import {
  CodexAppServerClient,
  type AppServerMessage,
  type CodexAppServerConnection,
  type CodexAppServerLaunchMode
} from "./codexAppServerClient";

type NotificationListener = (message: AppServerMessage) => void | Promise<void>;
type ServerRequestHandler = (client: CodexAppServerConnection, message: AppServerMessage) => boolean | Promise<boolean>;
type ExitListener = (error: Error) => void | Promise<void>;
type AppServerClientFactory = (
  launchMode: CodexAppServerLaunchMode,
  callbacks: {
    onNotification: (message: AppServerMessage) => void;
    onServerRequest: (client: CodexAppServerConnection, message: AppServerMessage) => void;
    onExit: (client: CodexAppServerConnection, error: Error) => void;
  }
) => CodexAppServerConnection;

interface CodexAppServerHostOptions {
  preferDesktopProxy?: boolean;
  clientFactory?: AppServerClientFactory;
}

export class CodexAppServerHost {
  private client: CodexAppServerConnection | null = null;
  private initializing: Promise<CodexAppServerConnection> | null = null;
  private readonly notificationListeners = new Set<NotificationListener>();
  private readonly serverRequestHandlers = new Set<ServerRequestHandler>();
  private readonly exitListeners = new Set<ExitListener>();
  private readonly preferDesktopProxy: boolean;
  private readonly clientFactory: AppServerClientFactory;

  constructor(
    private readonly command: string,
    private readonly args: string[],
    options: CodexAppServerHostOptions = {}
  ) {
    this.preferDesktopProxy = options.preferDesktopProxy ?? true;
    this.clientFactory = options.clientFactory ?? ((launchMode, callbacks) => {
      let createdClient: CodexAppServerClient;
      createdClient = new CodexAppServerClient(
        this.command,
        this.args,
        callbacks.onNotification,
        (client, message) => callbacks.onServerRequest(client, message),
        (error) => callbacks.onExit(createdClient, error),
        launchMode
      );
      return createdClient;
    });
  }

  onNotification(listener: NotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onServerRequest(handler: ServerRequestHandler): () => void {
    this.serverRequestHandlers.add(handler);
    return () => this.serverRequestHandlers.delete(handler);
  }

  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    const client = await this.ensureClient();
    return client.request<T>(method, params);
  }

  async preferDesktopConnection(): Promise<boolean> {
    if (!this.preferDesktopProxy) {
      return false;
    }
    if (isDesktopProxyClient(this.client)) {
      return true;
    }
    if (this.initializing) {
      await this.initializing.catch(() => undefined);
      if (isDesktopProxyClient(this.client)) {
        return true;
      }
    }
    const proxyClient = await this.tryCreateClient("desktop_proxy");
    if (!proxyClient) {
      return false;
    }
    const previous = this.client;
    this.client = proxyClient;
    previous?.close();
    return true;
  }

  getConnectionMode(): CodexAppServerLaunchMode | null {
    return this.client?.launchMode ?? null;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const client = await this.ensureClient();
    client.notify(method, params);
  }

  async respond(id: number, result: unknown): Promise<void> {
    const client = await this.ensureClient();
    client.respond(id, result);
  }

  close(): void {
    this.initializing = null;
    this.client?.close();
    this.client = null;
  }

  private async ensureClient(): Promise<CodexAppServerConnection> {
    if (this.client) {
      return this.client;
    }
    if (this.initializing) {
      return this.initializing;
    }

    this.initializing = this.createClient();
    try {
      this.client = await this.initializing;
      return this.client;
    } finally {
      this.initializing = null;
    }
  }

  private async createClient(): Promise<CodexAppServerConnection> {
    if (this.preferDesktopProxy) {
      const proxyClient = await this.tryCreateClient("desktop_proxy");
      if (proxyClient) {
        return proxyClient;
      }
    }
    const standaloneClient = await this.tryCreateClient("standalone");
    if (!standaloneClient) {
      throw new Error("Unable to start Codex app-server");
    }
    return standaloneClient;
  }

  private async tryCreateClient(launchMode: CodexAppServerLaunchMode): Promise<CodexAppServerConnection | null> {
    const client = this.clientFactory(launchMode, {
      onNotification: (message) => this.dispatchNotification(message),
      onServerRequest: (client, message) => {
        void this.dispatchServerRequest(client, message);
      },
      onExit: (client, error) => {
        if (this.client === client) {
          this.client = null;
          this.dispatchExit(error);
        }
      }
    });
    try {
      await client.initialize();
      return client;
    } catch {
      client.close();
      return null;
    }
  }

  private dispatchNotification(message: AppServerMessage): void {
    for (const listener of this.notificationListeners) {
      void Promise.resolve(listener(message)).catch((error) => {
        console.error("Codex app-server notification listener failed", error);
      });
    }
  }

  private async dispatchServerRequest(client: CodexAppServerConnection, message: AppServerMessage): Promise<void> {
    for (const handler of this.serverRequestHandlers) {
      try {
        if (await handler(client, message)) {
          return;
        }
      } catch (error) {
        console.error("Codex app-server request handler failed", error);
      }
    }
    respondToUnsupportedServerRequest(client, message);
  }

  private dispatchExit(error: Error): void {
    for (const listener of this.exitListeners) {
      void Promise.resolve(listener(error)).catch((listenerError) => {
        console.error("Codex app-server exit listener failed", listenerError);
      });
    }
  }
}

function isDesktopProxyClient(client: CodexAppServerConnection | null): boolean {
  return client?.launchMode === "desktop_proxy";
}

function respondToUnsupportedServerRequest(client: CodexAppServerConnection, message: AppServerMessage): void {
  const id = typeof message.id === "number" ? message.id : null;
  const method = typeof message.method === "string" ? message.method : "";
  if (id === null) {
    return;
  }
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval" ||
    method === "item/permissions/requestApproval" ||
    method === "applyPatchApproval" ||
    method === "execCommandApproval"
  ) {
    client.respond(id, { decision: "decline" });
    return;
  }
  if (method === "item/tool/requestUserInput") {
    client.respond(id, { answers: {} });
    return;
  }
  client.respond(id, { error: "Unsupported Agent Port app-server request" });
}
