import { apiFetch, type PublicRepo } from "./client";

export function getRepos(): Promise<{ repos: PublicRepo[]; defaultRepo: string }> {
  return apiFetch("/api/repos");
}
