import { open, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  appRoot,
  ensureManagedServerDirs,
  findManagedServerPid,
  logFile,
  pidFile,
  removePidFile,
  serverRoot,
  stopManagedServer
} from "./background-runtime";

const startCommand = [process.execPath, "--env-file=../.env", "dist/index.js"];
const startEnv = { ...process.env, RCD_RUN_MODE: "managed" };
const startupFailureWindowMs = 300;

await ensureManagedServerDirs();

const existingPid = await findManagedServerPid();
if (existingPid) {
  await stopManagedServer(existingPid, "Restarting existing");
}

const logHandle = await open(logFile, "a");
const subprocess = Bun.spawn(startCommand, {
  cwd: serverRoot,
  detached: true,
  env: startEnv,
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
