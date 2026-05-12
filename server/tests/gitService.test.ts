import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { GitService } from "../src/services/gitService";

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("git service", () => {
  test("includes per-file staged and unstaged line stats", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "agent-port-git-"));
    tempRoots.push(repoPath);
    await git(repoPath, "init");
    await git(repoPath, "config", "user.email", "agent-port@example.com");
    await git(repoPath, "config", "user.name", "Agent Port");
    await fs.writeFile(path.join(repoPath, "tracked.txt"), "one\n", "utf8");
    await git(repoPath, "add", "tracked.txt");
    await git(repoPath, "commit", "-m", "initial");

    await fs.writeFile(path.join(repoPath, "tracked.txt"), "one\ntwo\n", "utf8");
    await fs.writeFile(path.join(repoPath, "staged.txt"), "alpha\nbeta\n", "utf8");
    await git(repoPath, "add", "staged.txt");

    const status = await new GitService().getStatus(repoPath);
    const tracked = status.files.find((file) => file.path === "tracked.txt");
    const staged = status.files.find((file) => file.path === "staged.txt");

    expect(tracked?.additions).toBe(1);
    expect(tracked?.deletions).toBe(0);
    expect(staged?.additions).toBe(2);
    expect(staged?.deletions).toBe(0);
  });
});

function git(repoPath: string, ...args: string[]): Promise<unknown> {
  return execFileAsync("git", ["-C", repoPath, ...args], { timeout: 10_000 });
}
