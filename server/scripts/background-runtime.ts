import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const serverRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const appRoot = path.resolve(serverRoot, "..");
export const runtimeDir = path.join(appRoot, "data", "runtime");
export const logDir = path.join(appRoot, "data", "logs");
export const pidFile = path.join(runtimeDir, "server.pid");
export const logFile = path.join(logDir, "server.log");

const defaultServerPort = 8787;
const shutdownTimeoutMs = 3000;

export async function ensureManagedServerDirs(): Promise<void> {
  await mkdir(runtimeDir, { recursive: true });
  await mkdir(logDir, { recursive: true });
}

export async function readPidFile(): Promise<number | null> {
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

export async function findManagedServerPid(): Promise<number | null> {
  const existingPid = await readPidFile();
  if (existingPid) {
    return existingPid;
  }

  const serverPort = await readServerPort();
  return findAgentPortListenerPid(serverPort);
}

export async function stopManagedServer(pid: number, actionLabel: string): Promise<void> {
  if (!isProcessAlive(pid)) {
    await removePidFile();
    return;
  }

  console.log(`${actionLabel} Agent Port server PID ${pid}.`);
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

export async function removePidFile(): Promise<void> {
  await rm(pidFile, { force: true });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readServerPort(): Promise<number> {
  const envPort = process.env.RCD_SERVER_PORT ?? (await readEnvValue("RCD_SERVER_PORT"));
  const port = Number(envPort ?? defaultServerPort);
  return Number.isInteger(port) && port > 0 ? port : defaultServerPort;
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
