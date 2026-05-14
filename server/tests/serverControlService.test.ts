import { describe, expect, test } from "bun:test";
import { ServerControlService } from "../src/services/serverControlService";

describe("server control service", () => {
  test("rejects restart outside managed runtime", () => {
    let restarted = false;
    const service = new ServerControlService(
      () => {
        restarted = true;
      },
      () => false
    );

    expect(service.requestRestart()).toEqual({
      ok: false,
      error: "Server restart is only available in managed runtime. Run bun run build && bun run start."
    });
    expect(restarted).toBe(false);
  });

  test("schedules restart in managed runtime", async () => {
    let restarted = false;
    const service = new ServerControlService(
      () => {
        restarted = true;
      },
      () => true
    );

    expect(service.requestRestart()).toEqual({ ok: true, scheduled: true });
    await Bun.sleep(300);
    expect(restarted).toBe(true);
  });
});
