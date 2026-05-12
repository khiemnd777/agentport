import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config";
import type { PublicRepo, Repo } from "../domain/repoTypes";
import { validateRepoKey } from "../utils/validation";
import { notFound } from "../utils/httpErrors";

export class RepoRegistry {
  private readonly repos = new Map<string, Repo>();

  constructor(private readonly config: AppConfig) {}

  async init(): Promise<void> {
    for (const [key, repoConfig] of Object.entries(this.config.repos)) {
      validateRepoKey(key);
      const repoPath = path.resolve(repoConfig.path);
      const stat = await fs.stat(repoPath).catch(() => null);
      if (!stat?.isDirectory()) {
        throw new Error(`Configured repo "${key}" does not exist or is not a directory: ${repoPath}`);
      }
      this.repos.set(key, {
        key,
        label: repoConfig.label,
        path: repoPath
      });
    }
  }

  getDefaultRepoKey(): string {
    return this.config.defaultRepo;
  }

  listPublic(): PublicRepo[] {
    return [...this.repos.values()].map((repo) => ({ key: repo.key, label: repo.label }));
  }

  getRepo(repoKey: string): Repo {
    validateRepoKey(repoKey);
    const repo = this.repos.get(repoKey);
    if (!repo) {
      throw notFound("Unknown repo_key");
    }
    return repo;
  }
}
