import { apiFetch, type RemoteCodexEvent, type Task } from "./client";

export function listTasks(): Promise<{ tasks: Task[] }> {
  return apiFetch("/api/tasks");
}

export function getTask(taskId: string): Promise<{ task: Task }> {
  return apiFetch(`/api/tasks/${taskId}`);
}

export function createTask(
  sessionId: string,
  input: { title?: string; prompt: string }
): Promise<{ task: Task }> {
  return apiFetch(`/api/sessions/${sessionId}/tasks`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function sendTaskInput(taskId: string, text: string): Promise<{ task: Task }> {
  return apiFetch(`/api/tasks/${taskId}/input`, {
    method: "POST",
    body: JSON.stringify({ text })
  });
}

export function cancelTask(taskId: string): Promise<{ task: Task }> {
  return apiFetch(`/api/tasks/${taskId}/cancel`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function listTaskEvents(taskId: string): Promise<{ events: RemoteCodexEvent[] }> {
  return apiFetch(`/api/tasks/${taskId}/events`);
}
