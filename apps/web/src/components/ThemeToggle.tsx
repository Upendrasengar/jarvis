// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { useState } from "react";
import { setThemeMode, themeMode, type ThemeMode } from "./theme";

const NEXT: Record<ThemeMode, ThemeMode> = { dark: "light", light: "system", system: "dark" };
const FACE: Record<ThemeMode, string> = { dark: "\u263e", light: "\u2600\ufe0e", system: "\u25d0" };

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(themeMode);
  const cycle = () => {
    const next = NEXT[mode];
    setMode(next);
    setThemeMode(next);
  };
  return (
    <button
      onClick={cycle}
      title={`Theme: ${mode} — click for ${NEXT[mode]}`}
      className="flex items-center gap-1.5 rounded-lg border border-transparent px-2 py-[6px] text-[14px] text-[var(--dim)] hover:text-[var(--bright)]"
    >
      {FACE[mode]}
      <span className="text-[8px] uppercase tracking-[1.5px]">{mode}</span>
    </button>
  );
}
