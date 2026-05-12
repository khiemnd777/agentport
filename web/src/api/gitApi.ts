import { apiFetch, type GitStatus } from "./client";

export function getGitStatus(sessionId: string): Promise<{ status: GitStatus }> {
  return apiFetch(`/api/sessions/${sessionId}/git/status`);
}

export function getGitDiff(sessionId: string, file?: string): Promise<{ diff: string; file: string | null }> {
  const query = file ? `?file=${encodeURIComponent(file)}` : "";
  return apiFetch(`/api/sessions/${sessionId}/git/diff${query}`);
}
