import { access } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { buildExpectBridgeScript, buildExpectResizeMarker } from "../src/pty/expectBridge";
import { createPtyEnv } from "../src/pty/ptyEnv";
import { wrapPromptForRemoteCodex } from "../src/services/codexPromptWrapper";

const vietnamesePrompt = "Bạn đang dùng skills nào?";

describe("remote prompt encoding", () => {
  test("preserves Vietnamese text in wrapped prompts", () => {
    expect(wrapPromptForRemoteCodex(vietnamesePrompt)).toContain(vietnamesePrompt);
  });

  test("forces a UTF-8 locale for spawned Codex PTY sessions", () => {
    const env = createPtyEnv({ LANG: "C", LC_ALL: "C", PATH: "/bin" });
    expect(env.LANG).toContain("UTF-8");
    expect(env.LC_CTYPE).toContain("UTF-8");
    expect(env.LC_ALL).toContain("UTF-8");
    expect(env.PATH).toBe("/bin");
  });

  test("expect fallback forwards Vietnamese input without mojibake", async () => {
    if (!(await fileExists("/usr/bin/expect"))) {
      return;
    }

    const process = Bun.spawn(["/usr/bin/expect", "-c", buildExpectBridgeScript(["/bin/cat"])], {
      env: createPtyEnv({ PATH: "/bin:/usr/bin" }),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    });
    const stdout = new Response(process.stdout).text();
    process.stdin.write(`${vietnamesePrompt}\n`);
    await process.stdin.flush();
    await Bun.sleep(100);
    process.kill();

    const output = await stdout;
    await process.exited.catch(() => undefined);
    expect(output).toContain(vietnamesePrompt);
    expect(output).not.toContain("Báº");
    expect(output).not.toContain("dÃ");
  });

  test("expect fallback script initializes and accepts terminal size changes", () => {
    const script = buildExpectBridgeScript(["/bin/cat"], 132, 35);
    expect(script).toContain("stty columns 132 rows 35");
    expect(script).toContain("AgentPortResize");
    expect(buildExpectResizeMarker(160, 48)).toBe("\u001b]1337;AgentPortResize=160;48\u0007");
  });
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
