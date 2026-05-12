import fs from "node:fs/promises";
import path from "node:path";
import { badRequest, conflict, notFound } from "../utils/httpErrors";
import { assertPathInsideRepo, validateRelativeFilePath } from "../utils/validation";

const MAX_PREVIEW_BYTES = 512 * 1024;
const MAX_LOOKUP_ENTRIES = 20_000;
const SKIPPED_LOOKUP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage"]);

export interface FilePreview {
  path: string;
  name: string;
  size_bytes: number;
  content: string;
}

export class FileContentService {
  async readRelativeFile(repoPath: string, relativePath: unknown): Promise<FilePreview> {
    const filePath = validateRelativeFilePath(relativePath);
    if (!filePath) {
      throw badRequest("File path is required");
    }
    return this.readResolvedFile(repoPath, filePath);
  }

  async findAndReadByName(repoPath: string, fileName: unknown): Promise<FilePreview> {
    const name = validateFileLookupName(fileName);
    const matches = await this.findFilesByName(repoPath, name);
    if (matches.length === 0) {
      throw notFound("File not found in this session repo");
    }
    if (matches.length > 1) {
      throw conflict("Multiple files match this name; use a repo-relative path");
    }
    return this.readResolvedFile(repoPath, matches[0]);
  }

  private async readResolvedFile(repoPath: string, relativePath: string): Promise<FilePreview> {
    const normalizedPath = relativePath.split(/[\\/]+/).join("/");
    const absolutePath = assertPathInsideRepo(repoPath, normalizedPath);
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat) {
      throw notFound("File not found in this session repo");
    }
    if (!stat.isFile()) {
      throw badRequest("Path is not a file");
    }
    if (stat.size > MAX_PREVIEW_BYTES) {
      throw badRequest("File is too large to preview");
    }

    const bytes = await fs.readFile(absolutePath);
    if (bytes.includes(0)) {
      throw badRequest("File is not a text file");
    }
    return {
      path: normalizedPath,
      name: path.basename(normalizedPath),
      size_bytes: stat.size,
      content: bytes.toString("utf8")
    };
  }

  private async findFilesByName(repoPath: string, fileName: string): Promise<string[]> {
    const repoRoot = path.resolve(repoPath);
    const matches: string[] = [];
    let visited = 0;

    async function walk(relativeDir: string): Promise<void> {
      if (visited > MAX_LOOKUP_ENTRIES || matches.length > 1) {
        return;
      }
      const absoluteDir = assertPathInsideRepo(repoRoot, relativeDir);
      const entries = await fs.readdir(absoluteDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        visited += 1;
        if (visited > MAX_LOOKUP_ENTRIES || matches.length > 1) {
          return;
        }
        if (entry.name === "." || entry.name === "..") {
          continue;
        }
        const childRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!SKIPPED_LOOKUP_DIRS.has(entry.name)) {
            await walk(childRelative);
          }
          continue;
        }
        if (entry.isFile() && entry.name === fileName) {
          matches.push(childRelative);
        }
      }
    }

    await walk("");
    return matches;
  }
}

function validateFileLookupName(value: unknown): string {
  if (typeof value !== "string") {
    throw badRequest("File name is required");
  }
  const name = value.trim();
  if (!name || name.length > 200 || name.includes("\0") || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw badRequest("Invalid file name");
  }
  return name;
}
