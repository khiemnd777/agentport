export type AttachmentKind = "image" | "video" | "file";

export interface PublicAttachmentMetadata {
  id: string;
  session_id: string;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  kind: AttachmentKind;
  created_at: string;
}
