// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { NavLink, Outlet } from "react-router-dom";
import { RecordingPill } from "../features/calls/RecordingPill";
import { HeaderVoice } from "../features/voice/HeaderVoice";
import { ThemeToggle } from "../components/ThemeToggle";
import { useLive } from "../lib/live";
import { useWorkerDelivery } from "../lib/workerDelivery";

const TABS = [
  { to: "/overview", label: "OVERVIEW" },
  { to: "/chat", label: "CHAT" },
  { to: "/brain", label: "BRAIN" },
  { to: "/projects", label: "PROJECTS" },
  { to: "/calls", label: "CALLS" },
  { to: "/actions", label: "ACTIONS" },
  { to: "/notes", label: "NOTES" },
  { to: "/digest", label: "DIGEST" },
];

export function Layout() {
  useLive();
  useWorkerDelivery();
  return (
    <div className="flex h-full flex-col">
      <header className="z-10 flex items-center gap-4 border-b border-[var(--line)] px-5 py-3 backdrop-blur-xl">
        <span className="flex items-center gap-2 font-bold tracking-[3px] text-[var(--bright)]">
          <span className="blip h-[9px] w-[9px] rounded-full bg-[var(--cyan)] shadow-[0_0_12px_var(--cyan)]" />
          J.A.R.V.I.S
        </span>
        <span className="text-[11px] tracking-widest text-[var(--dim)]">
          <b className="text-[var(--green)]">● ONLINE</b> · LOCAL
        </span>
        <HeaderVoice />
        <RecordingPill />
        <nav className="ml-auto flex items-center gap-[2px]">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `rounded-lg border px-3 py-[6px] text-[13px] font-semibold tracking-wider transition ` +
                (isActive
                  ? "border-[rgba(57,215,255,.4)] bg-[rgba(57,215,255,.08)] text-[var(--cyan)] shadow-[0_0_14px_rgba(57,215,255,.2)]"
                  : "border-transparent text-[var(--dim)] hover:text-[var(--bright)]")
              }
            >
              {t.label}
            </NavLink>
          ))}
          <NavLink
            to="/settings"
            title="Settings"
            className={({ isActive }) =>
              `rounded-lg border px-2 py-[6px] text-[14px] ` +
              (isActive
                ? "border-[rgba(57,215,255,.4)] bg-[rgba(57,215,255,.08)] text-[var(--cyan)]"
                : "border-transparent text-[var(--dim)] hover:text-[var(--bright)]")
            }
          >
            ⚙
          </NavLink>
          <ThemeToggle />
        </nav>
      </header>
      <main className="relative min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
