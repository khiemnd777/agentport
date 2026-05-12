import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { FileContentService } from "../src/services/fileContentService";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("file content service", () => {
  test("reads repo-relative text files inside the repo", async () => {
    const repoPath = await createRepo();
    await fs.mkdir(path.join(repoPath, "server/src/services"), { recursive: true });
    await fs.writeFile(path.join(repoPath, "server/src/services/attachmentService.ts"), "export const ok = true;\n", "utf8");

    const preview = await new FileContentService().readRelativeFile(repoPath, "server/src/services/attachmentService.ts");

    expect(preview.path).toBe("server/src/services/attachmentService.ts");
    expect(preview.name).toBe("attachmentService.ts");
    expect(preview.content).toBe("export const ok = true;\n");
  });

  test("rejects absolute paths and path traversal", async () => {
    const repoPath = await createRepo();
    const service = new FileContentService();

    await expect(service.readRelativeFile(repoPath, path.join(repoPath, "secret.txt"))).rejects.toThrow("Invalid file path");
    await expect(service.readRelativeFile(repoPath, "../secret.txt")).rejects.toThrow("Invalid file path");
  });

  test("resolves a unique basename without accepting raw paths", async () => {
    const repoPath = await createRepo();
    await fs.mkdir(path.join(repoPath, "server/src/services"), { recursive: true });
    await fs.writeFile(path.join(repoPath, "server/src/services/attachmentService.ts"), "service\n", "utf8");

    const preview = await new FileContentService().findAndReadByName(repoPath, "attachmentService.ts");

    expect(preview.path).toBe("server/src/services/attachmentService.ts");
    expect(preview.content).toBe("service\n");
  });

  test("rejects ambiguous basename matches", async () => {
    const repoPath = await createRepo();
    await fs.mkdir(path.join(repoPath, "a"), { recursive: true });
    await fs.mkdir(path.join(repoPath, "b"), { recursive: true });
    await fs.writeFile(path.join(repoPath, "a/index.ts"), "a\n", "utf8");
    await fs.writeFile(path.join(repoPath, "b/index.ts"), "b\n", "utf8");

    await expect(new FileContentService().findAndReadByName(repoPath, "index.ts")).rejects.toThrow(
      "Multiple files match this name"
    );
  });
});

async function createRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "agent-port-files-"));
  tempRoots.push(repoPath);
  return repoPath;
}
