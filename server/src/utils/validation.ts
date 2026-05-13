import path from "node:path";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const repoKeyPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const branchPattern = /^(?!\/)(?!.*\/\/)(?!.*\.\.)(?!.*@\{)(?!.*\\)(?!.*\s)(?!.*\.lock$)[A-Za-z0-9._/-]{1,120}$/;

export function validateRepoKey(value: unknown): string {
  if (typeof value !== "string" || !repoKeyPattern.test(value)) {
    throw new Error("Invalid repo_key");
  }
  return value;
}

export function validateRepoLabel(value: unknown): string {
  const label = typeof value === "string" ? value.trim() : "";
  if (!label || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)) {
    throw new Error("Invalid repo label");
  }
  return label;
}

export function validateFolderName(value: unknown): string {
  const folderName = typeof value === "string" ? value.trim() : "";
  if (
    !folderName ||
    folderName.length > 255 ||
    folderName === "." ||
    folderName === ".." ||
    folderName.includes("\0") ||
    folderName.includes("/") ||
    folderName.includes("\\") ||
    path.basename(folderName) !== folderName
  ) {
    throw new Error("Invalid folder name");
  }
  return folderName;
}

export function validateSessionId(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    throw new Error("Invalid session id");
  }
  return value;
}

export function validateTaskId(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    throw new Error("Invalid task id");
  }
  return value;
}

export function validateBranchName(value: unknown): string | null {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !branchPattern.test(value) || value.endsWith("/") || value.endsWith(".")) {
    throw new Error("Invalid branch_name");
  }
  return value;
}

export function validateRelativeFilePath(value: unknown): string | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("Invalid file path");
  }
  if (value.includes("\0") || path.isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error("Invalid file path");
  }
  return value;
}

export function assertPathInsideRepo(repoPath: string, relativePath: string): string {
  const repoRoot = path.resolve(repoPath);
  const candidate = path.resolve(repoRoot, relativePath);
  if (candidate !== repoRoot && !candidate.startsWith(repoRoot + path.sep)) {
    throw new Error("File path escapes repository");
  }
  return candidate;
}

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}
