import { apiFetch, type CodexSession } from "./client";

export function listSessions(input: { includeArchived?: boolean } = {}): Promise<{ sessions: CodexSession[] }> {
  const params = input.includeArchived ? "?include_archived=true" : "";
  return apiFetch(`/api/sessions${params}`);
}

export function createSession(input: {
  repo_key: string;
  title?: string;
  branch_name?: string;
  initial_prompt?: string;
}): Promise<{ session: CodexSession }> {
  return apiFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function closeSession(sessionId: string): Promise<{ session: CodexSession }> {
  return apiFetch(`/api/sessions/${sessionId}/close`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function archiveSession(sessionId: string): Promise<{ session: CodexSession }> {
  return apiFetch(`/api/sessions/${sessionId}/archive`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function deleteSession(sessionId: string): Promise<{ ok: true }> {
  return apiFetch(`/api/sessions/${sessionId}`, {
    method: "DELETE"
  });
}
