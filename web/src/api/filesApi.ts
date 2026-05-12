import { apiFetch, type FilePreview } from "./client";

export function getSessionFileContent(
  sessionId: string,
  input: { file?: string; name?: string }
): Promise<{ file: FilePreview }> {
  const query = input.file
    ? `file=${encodeURIComponent(input.file)}`
    : `name=${encodeURIComponent(input.name ?? "")}`;
  return apiFetch(`/api/sessions/${sessionId}/files/content?${query}`);
}
