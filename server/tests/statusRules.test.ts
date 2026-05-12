import { describe, expect, test } from "bun:test";
import { canEnterWaitingForUser, validateStatusTransition } from "../src/domain/statusRules";
import { assertPathInsideRepo, validateBranchName, validateRelativeFilePath } from "../src/utils/validation";

describe("status rules", () => {
  test("WAITING_FOR_USER is web-managed only", () => {
    expect(canEnterWaitingForUser({ control_mode: "web_managed" })).toBe(true);
    expect(canEnterWaitingForUser({ control_mode: "local_terminal" })).toBe(false);
    expect(canEnterWaitingForUser({ control_mode: "non_interactive" })).toBe(false);
  });

  test("rejects waiting transition for local terminal tasks", () => {
    expect(() => validateStatusTransition("RUNNING", "WAITING_FOR_USER", "local_terminal")).toThrow();
    expect(() => validateStatusTransition("RUNNING", "WAITING_FOR_USER", "web_managed")).not.toThrow();
  });

  test("terminal task states do not return to running", () => {
    expect(() => validateStatusTransition("COMPLETED", "RUNNING", "web_managed")).toThrow();
  });
});

describe("validation", () => {
  test("validates branch names conservatively", () => {
    expect(validateBranchName("codex/my-task")).toBe("codex/my-task");
    expect(() => validateBranchName("../bad")).toThrow();
    expect(() => validateBranchName("bad lock")).toThrow();
  });

  test("rejects path traversal for git diff files", () => {
    expect(validateRelativeFilePath("src/App.tsx")).toBe("src/App.tsx");
    expect(() => validateRelativeFilePath("../secrets")).toThrow();
    expect(() => assertPathInsideRepo("/tmp/repo", "../secrets")).toThrow();
  });
});
