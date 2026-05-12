import type { PublicAttachmentMetadata } from "./attachmentTypes";

export type ChatMessageRole = "user" | "assistant" | "system";
export type ChatMessageStatus = "complete" | "streaming" | "error";
export type ChatActivityKind = "thinking";
export type ChatActivityStatus = "streaming" | "complete";

export interface ChatActivity {
  id: string;
  item_id: string | null;
  kind: ChatActivityKind;
  title: string;
  content: string;
  status: ChatActivityStatus;
  started_at: string;
  completed_at: string | null;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  attachments: PublicAttachmentMetadata[];
  activities: ChatActivity[];
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  turn_id: string | null;
  created_at: string;
  updated_at: string;
  error: string | null;
}
