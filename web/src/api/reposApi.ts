import { apiFetch, type PublicRepo, type RepoDiscoveryStatus, type RepoResolveCandidate } from "./client";

export function getRepos(): Promise<{ repos: PublicRepo[]; defaultRepo: string; repoDiscovery: RepoDiscoveryStatus }> {
  return apiFetch("/api/repos");
}

export function resolveRepoFolder(folderName: string): Promise<{
  folderName: string;
  repoDiscovery: RepoDiscoveryStatus;
  candidates: RepoResolveCandidate[];
}> {
  return apiFetch("/api/repos/resolve-folder", {
    method: "POST",
    body: JSON.stringify({ folderName })
  });
}

export function addRepo(input: {
  folderName: string;
  label: string;
  key: string;
  candidateId?: string;
}): Promise<{ repo: PublicRepo; repos: PublicRepo[]; defaultRepo: string }> {
  return apiFetch("/api/repos", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function removeRepo(repoKey: string): Promise<{ repos: PublicRepo[]; defaultRepo: string }> {
  return apiFetch(`/api/repos/${encodeURIComponent(repoKey)}`, {
    method: "DELETE"
  });
}

export function setDefaultRepo(repoKey: string): Promise<{ repos: PublicRepo[]; defaultRepo: string }> {
  return apiFetch("/api/repos/default", {
    method: "POST",
    body: JSON.stringify({ repoKey })
  });
}

export function requestServerRestart(): Promise<{ ok: true; scheduled: true }> {
  return apiFetch("/api/admin/restart", {
    method: "POST",
    body: JSON.stringify({})
  });
}
