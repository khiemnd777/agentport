import { Buffer } from "node:buffer";
import { badRequest } from "./httpErrors";

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
}

export function parsePageLimit(
  value: string | undefined,
  options: { defaultLimit?: number; maxLimit?: number } = {}
): number {
  const defaultLimit = options.defaultLimit ?? 30;
  const maxLimit = options.maxLimit ?? 100;
  if (value === undefined || value === "") {
    return defaultLimit;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("Invalid page limit");
  }
  return Math.min(limit, maxLimit);
}

export function encodePageCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function decodePageCursor(value: string | null | undefined): unknown {
  if (!value) {
    return null;
  }
  if (value.length > 1200 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw badRequest("Invalid page cursor");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    throw badRequest("Invalid page cursor");
  }
}

export function asCursorRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
