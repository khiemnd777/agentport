import { describe, expect, test } from "bun:test";
import {
  extractAgentDeltaFromCodexEvent,
  extractFinalAgentTextFromCodexEvent,
  extractThreadIdFromCodexEvent
} from "../src/services/codexExecEventParser";

describe("codex exec event parser", () => {
  test("extracts native app-server agent deltas", () => {
    const event = {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        delta: "Xin chao"
      }
    };
    expect(extractThreadIdFromCodexEvent(event)).toBe("thread-1");
    expect(extractAgentDeltaFromCodexEvent(event)).toBe("Xin chao");
  });

  test("extracts completed agent message text", () => {
    const event = {
      method: "item/completed",
      params: {
        threadId: "thread-2",
        turnId: "turn-2",
        item: {
          type: "agentMessage",
          id: "item-1",
          text: "Da xong",
          phase: null,
          memoryCitation: null
        }
      }
    };
    expect(extractThreadIdFromCodexEvent(event)).toBe("thread-2");
    expect(extractFinalAgentTextFromCodexEvent(event)).toBe("Da xong");
  });

  test("extracts final text from codex exec item.completed shape", () => {
    const event = {
      type: "item.completed",
      item: {
        id: "item-1",
        type: "agent_message",
        text: "streaming probe"
      }
    };
    expect(extractFinalAgentTextFromCodexEvent(event)).toBe("streaming probe");
  });

  test("extracts assistant text from role/content shaped events", () => {
    const event = {
      type: "item.completed",
      item: {
        role: "assistant",
        content: [{ type: "text", text: "Final answer" }]
      }
    };
    expect(extractFinalAgentTextFromCodexEvent(event)).toBe("Final answer");
  });
});
