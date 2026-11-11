"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "./Icon";

type Theme = "light" | "dark";
const listeners = new Set<() => void>();

function getTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("sej:theme", t);
  } catch {}
  listeners.forEach((l) => l());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getTheme,
    () => "light",
  );
}

export function ThemeToggle() {
  const theme = useTheme();
  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
      aria-label="Toggle dark mode"
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} className="size-4" />
    </button>
  );
}
