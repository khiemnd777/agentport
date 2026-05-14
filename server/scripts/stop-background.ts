import { ensureManagedServerDirs, findManagedServerPid, stopManagedServer } from "./background-runtime";

await ensureManagedServerDirs();

const existingPid = await findManagedServerPid();
if (!existingPid) {
  console.log("No managed Agent Port server is running.");
  process.exit(0);
}

await stopManagedServer(existingPid, "Stopping");
console.log("Agent Port server stopped.");
