"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/** Paper ↔ Ink theme switch. Persists the choice and re-themes the whole app. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) || "light";
    setTheme(current);
  }, []);

  function toggle() {
    const next: Theme = (document.documentElement.dataset.theme as Theme) === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("volo-theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  }

  const isDark = theme === "dark";
  return (
    <button
      onClick={toggle}
      className="btn btn-ghost !py-1.5 !px-2.5 text-[12.5px] gap-2"
      title={isDark ? "Switch to Paper (light)" : "Switch to Ink (dark)"}
      aria-label="Toggle theme"
      suppressHydrationWarning
    >
      <span aria-hidden style={{ display: "inline-flex" }} suppressHydrationWarning>
        {isDark ? <MoonIcon /> : <SunIcon />}
      </span>
      <span suppressHydrationWarning>{theme === null ? "Theme" : isDark ? "Ink" : "Paper"}</span>
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}
