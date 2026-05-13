import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const appRoot = path.resolve(serverRoot, "..");
const runtimeDir = path.join(appRoot, "data", "runtime");
const logDir = path.join(appRoot, "data", "logs");
const pidFile = path.join(runtimeDir, "server.pid");
const logFile = path.join(logDir, "server.log");
const startCommand = [process.execPath, "--env-file=../.env", "dist/index.js"];
const serverPort = await readServerPort();
const shutdownTimeoutMs = 3000;
const startupFailureWindowMs = 300;

await mkdir(runtimeDir, { recursive: true });
await mkdir(logDir, { recursive: true });

const existingPid = await readPidFile();
if (existingPid) {
  await stopExistingServer(existingPid);
} else {
  const listeningPid = await findAgentPortListenerPid(serverPort);
  if (listeningPid) {
    await stopExistingServer(listeningPid);
  }
}

const logHandle = await open(logFile, "a");
const subprocess = Bun.spawn(startCommand, {
  cwd: serverRoot,
  detached: true,
  stdin: "ignore",
  stdout: logHandle.fd,
  stderr: logHandle.fd
});

const earlyExitCode = await Promise.race<number | null>([
  subprocess.exited,
  Bun.sleep(startupFailureWindowMs).then(() => null)
]);

if (earlyExitCode !== null) {
  await logHandle.close();
  await removePidFile();
  console.error(`Agent Port server exited during startup with code ${earlyExitCode}.`);
  console.error(`Logs: ${path.relative(appRoot, logFile)}`);
  process.exit(earlyExitCode || 1);
}

subprocess.unref();
await writeFile(pidFile, `${subprocess.pid}\n`, "utf8");
await logHandle.close();

console.log(`Agent Port server started in background with PID ${subprocess.pid}.`);
console.log(`Logs: ${path.relative(appRoot, logFile)}`);

async function readPidFile(): Promise<number | null> {
  try {
    const raw = await readFile(pidFile, "utf8");
    const pid = Number(raw.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function stopExistingServer(pid: number): Promise<void> {
  if (!isProcessAlive(pid)) {
    await removePidFile();
    return;
  }

  console.log(`Restarting existing Agent Port server PID ${pid}.`);
  process.kill(pid, "SIGTERM");

  const deadline = Date.now() + shutdownTimeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      await removePidFile();
      return;
    }
    await Bun.sleep(100);
  }

  if (isProcessAlive(pid)) {
    process.kill(pid, "SIGKILL");
  }
  await removePidFile();
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function removePidFile(): Promise<void> {
  await rm(pidFile, { force: true });
}

async function readServerPort(): Promise<number> {
  const envPort = process.env.RCD_SERVER_PORT ?? (await readEnvValue("RCD_SERVER_PORT"));
  const port = Number(envPort ?? 8787);
  return Number.isInteger(port) && port > 0 ? port : 8787;
}

async function readEnvValue(name: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(appRoot, ".env"), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex === -1 || normalized.slice(0, equalsIndex).trim() !== name) {
      continue;
    }
    return stripEnvQuotes(normalized.slice(equalsIndex + 1).trim());
  }

  return null;
}

function stripEnvQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function findAgentPortListenerPid(port: number): Promise<number | null> {
  const result = Bun.spawnSync(["lsof", "-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
    stdout: "pipe",
    stderr: "ignore"
  });
  if (!result.success) {
    return null;
  }

  const pids = new TextDecoder()
    .decode(result.stdout)
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  for (const pid of pids) {
    if ((await readProcessCwd(pid)) === serverRoot) {
      return pid;
    }
  }

  return null;
}

async function readProcessCwd(pid: number): Promise<string | null> {
  const result = Bun.spawnSync(["lsof", "-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    stdout: "pipe",
    stderr: "ignore"
  });
  if (!result.success) {
    return null;
  }

  const cwdLine = new TextDecoder()
    .decode(result.stdout)
    .split(/\r?\n/)
    .find((line) => line.startsWith("n"));
  return cwdLine ? path.resolve(cwdLine.slice(1)) : null;
}
