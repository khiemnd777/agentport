import { describe, expect, test } from "bun:test";
import { terminalSocketUrl } from "../api/client";
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
});
