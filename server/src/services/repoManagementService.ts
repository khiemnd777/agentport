import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config";
import { loadConfigFile } from "../config";
import type { PublicRepo } from "../domain/repoTypes";
import { badRequest, conflict, notFound } from "../utils/httpErrors";
import { writeJsonFile } from "../utils/fileStore";
import { validateFolderName, validateRepoKey, validateRepoLabel } from "../utils/validation";
import type { RepoRegistry } from "./repoRegistry";

export interface RepoDiscoveryStatus {
  configured: boolean;
  searchRootCount: number;
  maxDepth: number;
}

export interface RepoResolveCandidate {
  id: string;
  folderName: string;
  suggestedKey: string;
  label: string;
  locationHint: string;
  gitRepository: boolean;
}

export interface RepoResolveResult {
  folderName: string;
  repoDiscovery: RepoDiscoveryStatus;
  candidates: RepoResolveCandidate[];
}

interface InternalRepoCandidate extends RepoResolveCandidate {
  path: string;
}

const ignoredDirectoryNames = new Set([
  ".git",
  ".cache",
  ".Trash",
  "Library",
  "node_modules",
  "dist",
  "build",
  "target",
  "DerivedData"
]);

export class RepoManagementService {
  constructor(
    private readonly config: AppConfig,
    private readonly configPath: string,
    private readonly repoRegistry: RepoRegistry
  ) {}

  getDiscoveryStatus(): RepoDiscoveryStatus {
    return {
      configured: this.config.repoDiscovery.searchRoots.length > 0,
      searchRootCount: this.config.repoDiscovery.searchRoots.length,
      maxDepth: this.config.repoDiscovery.maxDepth
    };
  }

  async resolveFolder(folderNameInput: unknown): Promise<RepoResolveResult> {
    const folderName = validateFolderNameForRequest(folderNameInput);
    const candidates = await this.findCandidates(folderName);
    return {
      folderName,
      repoDiscovery: this.getDiscoveryStatus(),
      candidates: candidates.map(toPublicCandidate)
    };
  }

  async addRepo(input: {
    folderName: unknown;
    label: unknown;
    key?: unknown;
    candidateId?: unknown;
  }): Promise<{ repo: PublicRepo; repos: PublicRepo[]; defaultRepo: string }> {
    if (!this.getDiscoveryStatus().configured) {
      throw conflict("Repo discovery search roots are not configured");
    }

    const folderName = validateFolderNameForRequest(input.folderName);
    const label = validateRepoLabelForRequest(input.label);
    const key = validateRepoKeyForRequest(
      typeof input.key === "string" && input.key.trim() ? input.key.trim() : slugifyRepoKey(label || folderName)
    );
    const candidateId = typeof input.candidateId === "string" ? input.candidateId.trim() : "";

    if (this.config.repos[key]) {
      throw conflict("Repository key is already configured");
    }

    const candidates = await this.findCandidates(folderName);
    if (!candidates.length) {
      throw notFound("Project folder was not found on the MacBook");
    }

    const candidate = selectCandidate(candidates, candidateId);
    const existingRepo = await this.findExistingRepoForPath(candidate.path);
    if (existingRepo) {
      throw conflict(`Project folder is already configured as ${existingRepo}`);
    }

    const sourceConfig = await this.readSourceConfig();
    sourceConfig.repos ??= {};
    sourceConfig.repos[key] = {
      label,
      path: candidate.path
    };
    sourceConfig.defaultRepo ||= key;

    await this.writeSourceConfig(sourceConfig);
    await this.reloadRuntimeConfig();

    return {
      repo: toPublicRepo(this.repoRegistry.getRepo(key)),
      repos: this.repoRegistry.listPublic(),
      defaultRepo: this.repoRegistry.getDefaultRepoKey()
    };
  }

  async removeRepo(repoKeyInput: unknown): Promise<{ repos: PublicRepo[]; defaultRepo: string }> {
    const repoKey = validateRepoKeyForRequest(repoKeyInput);
    if (!this.config.repos[repoKey]) {
      throw notFound("Unknown repo_key");
    }
    if (repoKey === this.config.defaultRepo) {
      throw conflict("Set another default repository before removing this one");
    }
    if (Object.keys(this.config.repos).length <= 1) {
      throw conflict("At least one repository must remain configured");
    }

    const sourceConfig = await this.readSourceConfig();
    if (!sourceConfig.repos?.[repoKey]) {
      throw notFound("Unknown repo_key");
    }
    delete sourceConfig.repos[repoKey];

    await this.writeSourceConfig(sourceConfig);
    await this.reloadRuntimeConfig();

    return {
      repos: this.repoRegistry.listPublic(),
      defaultRepo: this.repoRegistry.getDefaultRepoKey()
    };
  }

  async setDefaultRepo(repoKeyInput: unknown): Promise<{ repos: PublicRepo[]; defaultRepo: string }> {
    const repoKey = validateRepoKeyForRequest(repoKeyInput);
    if (!this.config.repos[repoKey]) {
      throw notFound("Unknown repo_key");
    }

    const sourceConfig = await this.readSourceConfig();
    sourceConfig.defaultRepo = repoKey;

    await this.writeSourceConfig(sourceConfig);
    await this.reloadRuntimeConfig();

    return {
      repos: this.repoRegistry.listPublic(),
      defaultRepo: this.repoRegistry.getDefaultRepoKey()
    };
  }

  private async findCandidates(folderName: string): Promise<InternalRepoCandidate[]> {
    const roots = this.config.repoDiscovery.searchRoots;
    if (!roots.length) {
      return [];
    }

    const candidates: InternalRepoCandidate[] = [];
    for (const root of roots) {
      const rootRealPath = await realDirectoryPath(root).catch(() => null);
      if (!rootRealPath) {
        continue;
      }
      await this.scanRoot(rootRealPath, folderName, candidates);
      if (candidates.length >= 25) {
        break;
      }
    }

    const byPath = new Map<string, InternalRepoCandidate>();
    for (const candidate of candidates) {
      byPath.set(candidate.path, candidate);
    }
    return [...byPath.values()];
  }

  private async scanRoot(
    rootRealPath: string,
    folderName: string,
    candidates: InternalRepoCandidate[]
  ): Promise<void> {
    const maxDepth = this.config.repoDiscovery.maxDepth;

    const scan = async (directoryPath: string, depth: number): Promise<void> => {
      if (candidates.length >= 25) {
        return;
      }

      if (path.basename(directoryPath) === folderName) {
        const candidateRealPath = await realDirectoryPath(directoryPath).catch(() => null);
        if (candidateRealPath && isPathInsideRoot(rootRealPath, candidateRealPath)) {
          candidates.push(await this.toCandidate(rootRealPath, candidateRealPath, folderName));
        }
      }

      if (depth >= maxDepth) {
        return;
      }

      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(directoryPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || ignoredDirectoryNames.has(entry.name)) {
          continue;
        }
        if (entry.name.startsWith(".") && entry.name !== folderName) {
          continue;
        }
        await scan(path.join(directoryPath, entry.name), depth + 1);
      }
    };

    await scan(rootRealPath, 0);
  }

  private async toCandidate(
    rootRealPath: string,
    repoPath: string,
    folderName: string
  ): Promise<InternalRepoCandidate> {
    const locationHint = path.relative(rootRealPath, repoPath).split(path.sep).join("/");
    return {
      id: candidateId(repoPath),
      path: repoPath,
      folderName,
      suggestedKey: slugifyRepoKey(folderName),
      label: titleize(folderName),
      locationHint: locationHint || folderName,
      gitRepository: await pathExists(path.join(repoPath, ".git"))
    };
  }

  private async findExistingRepoForPath(repoPath: string): Promise<string | null> {
    const realRepoPath = await realDirectoryPath(repoPath);
    for (const [key, repoConfig] of Object.entries(this.config.repos)) {
      const configuredPath = await realDirectoryPath(repoConfig.path).catch(() => null);
      if (configuredPath === realRepoPath) {
        return key;
      }
    }
    return null;
  }

  private async readSourceConfig(): Promise<AppConfig> {
    const raw = await fs.readFile(this.configPath, "utf8");
    return JSON.parse(raw) as AppConfig;
  }

  private async writeSourceConfig(sourceConfig: AppConfig): Promise<void> {
    await writeJsonFile(this.configPath, sourceConfig);
  }

  private async reloadRuntimeConfig(): Promise<void> {
    const reloadedConfig = await loadConfigFile(this.configPath);
    Object.assign(this.config, reloadedConfig);
    await this.repoRegistry.reload(this.config);
  }
}

function selectCandidate(candidates: InternalRepoCandidate[], candidateIdValue: string): InternalRepoCandidate {
  if (candidateIdValue) {
    const candidate = candidates.find((item) => item.id === candidateIdValue);
    if (!candidate) {
      throw badRequest("Selected project folder is no longer available");
    }
    return candidate;
  }
  if (candidates.length > 1) {
    throw conflict("Multiple matching project folders found");
  }
  return candidates[0];
}

function toPublicCandidate(candidate: InternalRepoCandidate): RepoResolveCandidate {
  const { path: _path, ...publicCandidate } = candidate;
  return publicCandidate;
}

function toPublicRepo(repo: { key: string; label: string }): PublicRepo {
  return { key: repo.key, label: repo.label };
}

async function realDirectoryPath(directoryPath: string): Promise<string> {
  const realPath = await fs.realpath(directoryPath);
  const stat = await fs.stat(realPath);
  if (!stat.isDirectory()) {
    throw new Error("Path is not a directory");
  }
  return realPath;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(rootPath + path.sep);
}

function candidateId(repoPath: string): string {
  return crypto.createHash("sha256").update(repoPath).digest("hex").slice(0, 32);
}

function slugifyRepoKey(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return slug || "repo";
}

function titleize(value: string): string {
  const normalized = value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.replace(/\b\w/g, (match) => match.toUpperCase()) || value;
}

function validateFolderNameForRequest(value: unknown): string {
  try {
    return validateFolderName(value);
  } catch (error) {
    throw badRequest((error as Error).message);
  }
}

function validateRepoLabelForRequest(value: unknown): string {
  try {
    return validateRepoLabel(value);
  } catch (error) {
    throw badRequest((error as Error).message);
  }
}

function validateRepoKeyForRequest(value: unknown): string {
  try {
    return validateRepoKey(value);
  } catch (error) {
    throw badRequest((error as Error).message);
  }
}
