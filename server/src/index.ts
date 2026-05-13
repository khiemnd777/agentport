import path from "node:path";
import { Hono } from "hono";
import { loadConfig } from "./config";
import { AuthService } from "./auth/authService";
import { authRoutes } from "./auth/authRoutes";
import { requireAuth } from "./auth/sessionAuth";
import { AppError } from "./utils/httpErrors";
import { RepoRegistry } from "./services/repoRegistry";
import { RepoManagementService } from "./services/repoManagementService";
import { EventStore } from "./services/eventStore";
import { LogStore } from "./services/logStore";
import { GitService } from "./services/gitService";
import { SessionService } from "./services/sessionService";
import { TaskService } from "./services/taskService";
import { ChatMessageStore } from "./services/chatMessageStore";
import { AttachmentService } from "./services/attachmentService";
import { FileContentService } from "./services/fileContentService";
import { CodexChatService } from "./services/codexChatService";
import { SessionCleanupService } from "./services/sessionCleanupService";
import { PushNotificationService } from "./services/pushNotificationService";
import { ServerControlService } from "./services/serverControlService";
import { PtySessionManager } from "./pty/PtySessionManager";
import { repoRoutes } from "./routes/repoRoutes";
import { adminRoutes } from "./routes/adminRoutes";
import { sessionRoutes } from "./routes/sessionRoutes";
import { taskRoutes } from "./routes/taskRoutes";
import { chatRoutes } from "./routes/chatRoutes";
import { attachmentRoutes } from "./routes/attachmentRoutes";
import { fileRoutes } from "./routes/fileRoutes";
import { gitRoutes } from "./routes/gitRoutes";
import { notificationRoutes } from "./routes/notificationRoutes";
import { ChatSocketBroadcaster } from "./websocket/chatSocket";
import { createRemoteSocketHandlers, tryUpgradeRemoteSocket, type RemoteSocketData } from "./websocket/socketHandlers";

const { config, paths } = await loadConfig();

if (config.auth.requirePassword && !process.env.APP_PASSWORD) {
  throw new Error("APP_PASSWORD is required when auth.requirePassword is true");
}

const authService = new AuthService(config, paths.dataRoot);
await authService.init();
const repoRegistry = new RepoRegistry(config);
await repoRegistry.init();
const repoManagementService = new RepoManagementService(config, paths.configPath, repoRegistry);

const eventStore = new EventStore(paths.dataRoot);
await eventStore.init();

const logStore = new LogStore(paths.dataRoot, config.limits.maxLogBytesPerSession);
await logStore.init();

const gitService = new GitService();
const sessionService = new SessionService(paths.dataRoot, config, repoRegistry, eventStore, gitService);
await sessionService.init();

const notificationService = new PushNotificationService(paths.dataRoot);
await notificationService.init();

const taskService = new TaskService(paths.dataRoot, config, sessionService, eventStore, notificationService);
await taskService.init();

const chatMessageStore = new ChatMessageStore(paths.dataRoot);
await chatMessageStore.init();

const attachmentService = new AttachmentService(paths.dataRoot);
await attachmentService.init();
const fileContentService = new FileContentService();

const chatBroadcaster = new ChatSocketBroadcaster();
const codexChatService = new CodexChatService(config, sessionService, chatMessageStore, chatBroadcaster, attachmentService);

const ptySessionManager = new PtySessionManager(config, sessionService, taskService, eventStore, logStore);
const sessionCleanupService = new SessionCleanupService(
  config,
  sessionService,
  taskService,
  codexChatService,
  eventStore,
  logStore,
  ptySessionManager
);
await sessionCleanupService.sweep();
setInterval(() => {
  void sessionCleanupService.sweep().catch((error) => {
    console.error("Session cleanup failed", error);
  });
}, 60_000);

const app = new Hono();
let serverRef: Bun.Server<RemoteSocketData> | null = null;
const serverControlService = new ServerControlService(() => {
  serverRef?.stop(true);
  process.exit(0);
});
app.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json({ error: error.message }, error.status as never);
  }
  if (error instanceof SyntaxError) {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  console.error(error);
  return c.json({ error: "Internal server error" }, 500);
});

app.route("/api/auth", authRoutes(authService));
app.use("/api/*", requireAuth(authService));
app.route("/api/repos", repoRoutes(repoRegistry, repoManagementService, sessionService));
app.route("/api/admin", adminRoutes(serverControlService));
app.route("/api/sessions", sessionRoutes(sessionService, taskService, ptySessionManager, sessionCleanupService));
app.route("/api", chatRoutes(sessionService, codexChatService));
app.route("/api", attachmentRoutes(sessionService, attachmentService));
app.route("/api", fileRoutes(sessionService, fileContentService));
app.route("/api", taskRoutes(sessionService, taskService, eventStore, ptySessionManager));
app.route("/api", gitRoutes(sessionService, gitService, eventStore));
app.route("/api", notificationRoutes(notificationService));

const server = Bun.serve({
  hostname: config.server.host,
  port: config.server.port,
  websocket: createRemoteSocketHandlers(ptySessionManager, chatBroadcaster),
  async fetch(request, bunServer) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/ws/")) {
      return tryUpgradeRemoteSocket(request, bunServer as Bun.Server<RemoteSocketData>, authService);
    }
    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request);
    }
    return serveFrontend(request, paths.webDist);
  }
});
serverRef = server;

console.log(`Agent Port server listening on http://${server.hostname}:${server.port}`);

async function serveFrontend(request: Request, webDist: string): Promise<Response> {
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(webDist, relative);
  const root = path.resolve(webDist);

  if (candidate.startsWith(root + path.sep) || candidate === root) {
    const file = Bun.file(candidate);
    if (await file.exists()) {
      return new Response(file, {
        headers: { "Content-Type": contentType(candidate) }
      });
    }
  }

  const indexFile = Bun.file(path.join(webDist, "index.html"));
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  return new Response("Agent Port API is running. Build the web app to serve the UI.", {
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath);
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}
