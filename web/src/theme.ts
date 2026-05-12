import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export type DisplayMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "remote-codex-display-mode";
const DISPLAY_MODES = new Set<DisplayMode>(["light", "dark", "system"]);

export function isDisplayMode(value: unknown): value is DisplayMode {
  return typeof value === "string" && DISPLAY_MODES.has(value as DisplayMode);
}

export function getStoredDisplayMode(): DisplayMode {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isDisplayMode(stored) ? stored : "system";
}

export function resolveDisplayMode(displayMode: DisplayMode): ResolvedTheme {
  if (displayMode !== "system") {
    return displayMode;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useDisplayMode() {
  const [displayMode, setDisplayModeState] = useState<DisplayMode>(() => getStoredDisplayMode());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveDisplayMode(getStoredDisplayMode()));

  useEffect(() => {
    const applyTheme = () => setResolvedTheme(resolveDisplayMode(displayMode));
    applyTheme();

    if (displayMode !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [displayMode]);

  useLayoutEffect(() => {
    document.documentElement.dataset.displayMode = displayMode;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [displayMode, resolvedTheme]);

  const setDisplayMode = useCallback((nextMode: DisplayMode) => {
    setDisplayModeState(nextMode);
    window.localStorage.setItem(STORAGE_KEY, nextMode);
  }, []);

  return { displayMode, resolvedTheme, setDisplayMode };
}
