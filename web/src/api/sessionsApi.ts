import { apiFetch, type CodexPermissionMode, type CodexReasoningEffort, type CodexSession } from "./client";

export type SessionListView = "active" | "archived" | "all";

export interface SessionPageResponse {
  sessions: CodexSession[];
  next_cursor: string | null;
  has_more: boolean;
}

export function listSessions(
  input: { includeArchived?: boolean; view?: SessionListView; limit?: number; cursor?: string | null } = {}
): Promise<SessionPageResponse> {
  const params = new URLSearchParams();
  if (input.view) {
    params.set("view", input.view);
  } else if (input.includeArchived) {
    params.set("include_archived", "true");
  }
  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }
  if (input.cursor) {
    params.set("cursor", input.cursor);
  }
  const query = params.toString();
  return apiFetch(`/api/sessions${query ? `?${query}` : ""}`);
}

export function getSession(sessionId: string): Promise<{ session: CodexSession }> {
  return apiFetch(`/api/sessions/${sessionId}`);
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

export function updateSessionRunProfile(
  sessionId: string,
  input: {
    model?: string;
    reasoning_effort?: CodexReasoningEffort;
    permission_mode?: CodexPermissionMode;
    plan_mode?: boolean;
  }
): Promise<{ session: CodexSession }> {
  return apiFetch(`/api/sessions/${sessionId}/run-profile`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function deleteSession(sessionId: string): Promise<{ ok: true }> {
  return apiFetch(`/api/sessions/${sessionId}`, {
    method: "DELETE"
  });
}
