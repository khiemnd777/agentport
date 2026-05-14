import { describe, expect, test } from "bun:test";
import { terminalSocketUrl } from "../api/client";
import { listCodexHistory, openCodexHistoryThread, sendChatMessage } from "../api/chatApi";
import { listSessions, updateSessionRunProfile } from "../api/sessionsApi";
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

  test("listSessions uses explicit session views", async () => {
    const originalFetch = globalThis.fetch;
    let requestedPath = "";
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requestedPath = String(input);
      return Promise.resolve(
        new Response(JSON.stringify({ sessions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }) as typeof fetch;
    try {
      await listSessions({ view: "archived", limit: 25, cursor: "cursor_1" });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestedPath).toBe("/api/sessions?view=archived&limit=25&cursor=cursor_1");
  });

  test("Codex history helpers use repo-scoped routes", async () => {
    const originalFetch = globalThis.fetch;
    const requested: Array<{ path: string; body: string }> = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      requested.push({ path: String(input), body: String(init?.body ?? "") });
      return Promise.resolve(
        new Response(JSON.stringify(requested.length === 1 ? { threads: [] } : { session: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }) as typeof fetch;
    try {
      await listCodexHistory("noah", { limit: 25, cursor: "cursor_1" });
      await openCodexHistoryThread("thread:1", "noah");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requested).toEqual([
      { path: "/api/codex/history?repo_key=noah&limit=25&cursor=cursor_1", body: "" },
      { path: "/api/codex/history/thread%3A1/open", body: JSON.stringify({ repo_key: "noah" }) }
    ]);
  });

  test("updateSessionRunProfile patches the session profile", async () => {
    const originalFetch = globalThis.fetch;
    let requestedPath = "";
    let requestMethod = "";
    let requestBody = "";
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      requestedPath = String(input);
      requestMethod = init?.method ?? "";
      requestBody = String(init?.body ?? "");
      return Promise.resolve(
        new Response(JSON.stringify({ session: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }) as typeof fetch;
    try {
      await updateSessionRunProfile("session-1", {
        model: "gpt-5.5",
        reasoning_effort: "medium",
        permission_mode: "auto-review",
        plan_mode: true
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestedPath).toBe("/api/sessions/session-1/run-profile");
    expect(requestMethod).toBe("PATCH");
    expect(JSON.parse(requestBody)).toEqual({
      model: "gpt-5.5",
      reasoning_effort: "medium",
      permission_mode: "auto-review",
      plan_mode: true
    });
  });
});
