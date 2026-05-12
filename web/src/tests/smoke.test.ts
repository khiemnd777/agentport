import { describe, expect, test } from "bun:test";
import { terminalSocketUrl } from "../api/client";
import { sendChatMessage } from "../api/chatApi";
import { isDisplayMode } from "../theme";

describe("web helpers", () => {
  test("terminalSocketUrl is exported", () => {
    expect(typeof terminalSocketUrl).toBe("function");
  });

  test("display mode helper accepts the supported modes", () => {
    expect(isDisplayMode("light")).toBe(true);
    expect(isDisplayMode("dark")).toBe(true);
    expect(isDisplayMode("system")).toBe(true);
    expect(isDisplayMode("auto")).toBe(false);
  });

  test("sendChatMessage forwards managed plan mode flag", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody = "";
    globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) => {
      requestBody = String(init?.body ?? "");
      return Promise.resolve(
        new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }) as typeof fetch;
    try {
      await sendChatMessage("session-1", "hello", "gpt-5.5", "medium", "default", ["attachment-1"], true);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(JSON.parse(requestBody)).toEqual({
      prompt: "hello",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      permissionMode: "default",
      attachmentIds: ["attachment-1"],
      planMode: true
    });
  });
});
