import { describe, expect, test } from "bun:test";
import { projectCodexThreadToMessages } from "../src/services/codexThreadProjection";

describe("codex thread projection", () => {
  test("projects Codex turns into deterministic chat messages", () => {
    const messages = projectCodexThreadToMessages("session-1", {
      id: "thread-1",
      turns: [
        {
          id: "turn-1",
          status: "completed",
          startedAt: 1_777_000_000,
          completedAt: 1_777_000_010,
          durationMs: 10_000,
          error: null,
          items: [
            {
              type: "userMessage",
              id: "user-item-1",
              content: [
                { type: "text", text: "Ship sync", text_elements: [] },
                { type: "localImage", path: "/Users/example/secret.png" }
              ]
            },
            { type: "plan", id: "plan-1", text: "1. Read\n2. Patch" },
            { type: "agentMessage", id: "commentary-1", text: "I am checking the thread store.", phase: "commentary" },
            { type: "agentMessage", id: "final-1", text: "Done.", phase: "final_answer" }
          ]
        }
      ]
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "codex:thread-1:turn-1:user-item-1:user",
      role: "user",
      content: "Ship sync\n\n[Image attached]",
      status: "complete"
    });
    expect(messages[0].content).not.toContain("/Users/example");
    expect(messages[1]).toMatchObject({
      id: "codex:thread-1:turn-1:commentary-1:assistant",
      role: "assistant",
      content: "Done.",
      status: "complete",
      duration_ms: 10_000
    });
    expect(messages[1].activities.map((activity) => activity.title)).toEqual(["Plan", "Thinking"]);
  });

  test("keeps in-progress desktop turns streaming for observe-only UI", () => {
    const messages = projectCodexThreadToMessages("session-1", {
      id: "thread-1",
      turns: [
        {
          id: "turn-2",
          status: "inProgress",
          startedAt: 1_777_000_100,
          completedAt: null,
          durationMs: null,
          error: null,
          items: [
            { type: "userMessage", id: "user-item-2", content: [{ type: "text", text: "Continue", text_elements: [] }] },
            { type: "agentMessage", id: "commentary-2", text: "Working from Desktop.", phase: "commentary" }
          ]
        }
      ]
    });

    expect(messages[1]).toMatchObject({
      id: "codex:thread-1:turn-2:commentary-2:assistant",
      role: "assistant",
      status: "streaming"
    });
    expect(messages[1].activities[0]?.status).toBe("streaming");
  });
});
