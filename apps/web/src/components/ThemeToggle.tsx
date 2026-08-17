import { useState } from "react";

export function ThemeToggle() {
  const [light, setLight] = useState(() =>
    document.documentElement.classList.contains("light"),
  );
  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    localStorage.setItem("jarvis_theme", next ? "light" : "dark");
  };
  return (
    <button
      onClick={toggle}
      title="Light/dark theme"
      className="rounded-lg border border-transparent px-2 py-[6px] text-[14px] text-[var(--dim)] hover:text-[var(--bright)]"
    >
      {light ? "☀︎" : "☾"}
    </button>
  );
}
