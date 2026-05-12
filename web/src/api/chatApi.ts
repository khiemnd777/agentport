import {
  apiFetch,
  type ChatAttachment,
  type ChatMessage,
  type CodexPermissionMode,
  type CodexReasoningEffort,
  type PublicCodexModel,
  type PublicCodexPermissionMode,
  type PublicCodexReasoningEffort
} from "./client";

export function listChatMessages(sessionId: string): Promise<{ messages: ChatMessage[] }> {
  return apiFetch(`/api/sessions/${sessionId}/messages`);
}

export function listCodexModels(): Promise<{
  models: PublicCodexModel[];
  defaultModel: string;
  reasoningEfforts: PublicCodexReasoningEffort[];
  defaultReasoningEffort: CodexReasoningEffort;
  permissionModes: PublicCodexPermissionMode[];
  defaultPermissionMode: CodexPermissionMode;
}> {
  return apiFetch("/api/chat/models");
}

export function sendChatMessage(
  sessionId: string,
  prompt: string,
  model: string,
  reasoningEffort: CodexReasoningEffort | "",
  permissionMode: CodexPermissionMode | "",
  attachmentIds: string[] = [],
  planMode = false
): Promise<{ messages: ChatMessage[] }> {
  return apiFetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ prompt, model, reasoningEffort, permissionMode, attachmentIds, planMode })
  });
}

export function submitChatUserInput(sessionId: string, text: string): Promise<{ messages: ChatMessage[] }> {
  return apiFetch(`/api/sessions/${sessionId}/messages/input`, {
    method: "POST",
    body: JSON.stringify({ text })
  });
}

export function uploadChatAttachment(sessionId: string, file: File): Promise<{ attachment: ChatAttachment }> {
  const body = new FormData();
  body.append("file", file);
  return apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/attachments`, {
    method: "POST",
    body
  });
}

export function chatAttachmentContentUrl(sessionId: string, attachmentId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}/content`;
}

export function interruptChat(sessionId: string): Promise<{ ok: true }> {
  return apiFetch(`/api/sessions/${sessionId}/messages/interrupt`, {
    method: "POST",
    body: JSON.stringify({})
  });
}
