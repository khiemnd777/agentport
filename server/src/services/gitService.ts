import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertPathInsideRepo, validateRelativeFilePath } from "../utils/validation";

const execFileAsync = promisify(execFile);

export interface GitChangedFile {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  originalPath?: string;
  additions?: number;
  deletions?: number;
}

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitChangedFile[];
  raw: string;
  isRepository: boolean;
  error?: string;
}

export class GitService {
  async getCurrentBranch(repoPath: string): Promise<string | null> {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "branch", "--show-current"], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });
    return stdout.trim() || null;
  }

  async getStatus(repoPath: string): Promise<GitStatus> {
    try {
      const { stdout } = await execFileAsync("git", ["-C", repoPath, "status", "--porcelain=v1", "-b"], {
        timeout: 10_000,
        maxBuffer: 1024 * 1024
      });
      const stats = await this.getChangedFileStats(repoPath);
      return parseGitStatus(stdout, stats);
    } catch (error) {
      if (isNotGitRepositoryError(error)) {
        return {
          branch: null,
          ahead: 0,
          behind: 0,
          files: [],
          raw: "",
          isRepository: false,
          error: "Configured path is not a Git repository."
        };
      }
      throw error;
    }
  }

  async getDiff(repoPath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", ["-C", repoPath, "diff", "--no-ext-diff", "--"], {
        timeout: 10_000,
        maxBuffer: 20 * 1024 * 1024
      });
      return stdout;
    } catch (error) {
      if (isNotGitRepositoryError(error)) {
        return "";
      }
      throw error;
    }
  }

  async getFileDiff(repoPath: string, filePath: string): Promise<string> {
    const relativePath = validateRelativeFilePath(filePath);
    if (!relativePath) {
      return this.getDiff(repoPath);
    }
    assertPathInsideRepo(repoPath, relativePath);
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", repoPath, "diff", "--no-ext-diff", "--", relativePath],
        {
          timeout: 10_000,
          maxBuffer: 20 * 1024 * 1024
        }
      );
      return stdout;
    } catch (error) {
      if (isNotGitRepositoryError(error)) {
        return "";
      }
      throw error;
    }
  }

  private async getChangedFileStats(repoPath: string): Promise<Map<string, GitFileStat>> {
    const stats = new Map<string, GitFileStat>();
    await this.addNumstat(stats, repoPath, ["diff", "--numstat", "--no-ext-diff", "--"]);
    await this.addNumstat(stats, repoPath, ["diff", "--cached", "--numstat", "--no-ext-diff", "--"]);
    return stats;
  }

  private async addNumstat(stats: Map<string, GitFileStat>, repoPath: string, args: string[]): Promise<void> {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024
    });
    for (const line of stdout.split("\n")) {
      const stat = parseNumstatLine(line);
      if (!stat) {
        continue;
      }
      const current = stats.get(stat.path) ?? { additions: 0, deletions: 0 };
      current.additions += stat.additions;
      current.deletions += stat.deletions;
      stats.set(stat.path, current);
    }
  }
}

interface GitFileStat {
  additions: number;
  deletions: number;
}

function parseGitStatus(raw: string, stats = new Map<string, GitFileStat>()): GitStatus {
  const lines = raw.split("\n").filter(Boolean);
  const branchLine = lines[0]?.startsWith("## ") ? lines.shift() ?? "" : "";
  const branchMatch = branchLine.match(/^## ([^.\[]+)/);
  const aheadMatch = branchLine.match(/ahead (\d+)/);
  const behindMatch = branchLine.match(/behind (\d+)/);

  return {
    branch: branchMatch?.[1]?.trim() || null,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
    files: lines.map((line) => withFileStats(parseStatusLine(line), stats)),
    raw,
    isRepository: true
  };
}

function withFileStats(file: GitChangedFile, stats: Map<string, GitFileStat>): GitChangedFile {
  const stat = stats.get(file.path) ?? (file.originalPath ? stats.get(file.originalPath) : undefined);
  if (!stat) {
    return file;
  }
  return {
    ...file,
    additions: stat.additions,
    deletions: stat.deletions
  };
}

function parseNumstatLine(line: string): ({ path: string } & GitFileStat) | null {
  if (!line.trim()) {
    return null;
  }
  const [rawAdditions, rawDeletions, ...pathParts] = line.split("\t");
  const pathValue = pathParts.join("\t");
  if (!rawAdditions || !rawDeletions || !pathValue || rawAdditions === "-" || rawDeletions === "-") {
    return null;
  }
  const additions = Number(rawAdditions);
  const deletions = Number(rawDeletions);
  if (!Number.isFinite(additions) || !Number.isFinite(deletions)) {
    return null;
  }
  return {
    path: normalizeNumstatPath(pathValue),
    additions,
    deletions
  };
}

function normalizeNumstatPath(value: string): string {
  const braceRename = value.match(/^(.*)\{(.+) => (.+)\}(.*)$/);
  if (braceRename) {
    return `${braceRename[1]}${braceRename[3]}${braceRename[4]}`;
  }
  const arrowParts = value.split(" => ");
  return arrowParts.length === 2 ? arrowParts[1] : value;
}

function parseStatusLine(line: string): GitChangedFile {
  const indexStatus = line[0] ?? " ";
  const worktreeStatus = line[1] ?? " ";
  const value = line.slice(3);
  const renameParts = value.split(" -> ");
  if (renameParts.length === 2) {
    return {
      originalPath: renameParts[0],
      path: renameParts[1],
      indexStatus,
      worktreeStatus
    };
  }
  return {
    path: value,
    indexStatus,
    worktreeStatus
  };
}

function isNotGitRepositoryError(error: unknown): boolean {
  const stderr = typeof (error as { stderr?: unknown }).stderr === "string" ? (error as { stderr: string }).stderr : "";
  const message = error instanceof Error ? error.message : "";
  const combined = `${stderr}\n${message}`.toLowerCase();
  return combined.includes("not a git repository");
}
