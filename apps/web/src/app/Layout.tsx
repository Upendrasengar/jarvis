// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// App shell — redesign v2: top status header + left icon rail (D2).
import { NavLink, Outlet } from "react-router-dom";
import { RecordingPill } from "../features/calls/RecordingPill";
import { HeaderVoice } from "../features/voice/HeaderVoice";
import { ThemeToggle } from "../components/ThemeToggle";
import { useLive } from "../lib/live";
import { useWorkerDelivery } from "../lib/workerDelivery";

const RAIL_ICONS: Record<string, React.ReactNode> = {
  overview: <path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />,
  digest: <path d="M7 3h7l3 3v15H7z M10 9h5 M10 13h5 M10 17h3" />,
  calls: <path d="M6 4c0 8 6 14 14 14l1-4-4-1.5-1.5 1.5c-3-1.2-5.3-3.5-6.5-6.5L10.5 6 9 2z" />,
  chat: <path d="M4 5h16v11H10l-5 4v-4H4z" />,
  brain: <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 6V3 M12 21v-3 M6 12H3 M21 12h-3 M6.5 6.5 5 5 M19 19l-1.5-1.5 M17.5 6.5 19 5 M5 19l1.5-1.5" />,
  actions: <path d="M13 2 6 14h5l-1 8 7-12h-5z" />,
  notes: <path d="M5 4h11l3 3v13H5z M8 10h8 M8 14h8" />,
  projects: <path d="M3 6h6l2 2h10v11H3z" />,
  settings: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M5 19l2-2" />,
};

const RAIL: Array<{ to: string; icon: string; label: string }> = [
  { to: "/overview", icon: "overview", label: "OVER" },
  { to: "/digest", icon: "digest", label: "DIGEST" },
  { to: "/calls", icon: "calls", label: "CALLS" },
  { to: "/chat", icon: "chat", label: "CHAT" },
  { to: "/brain", icon: "brain", label: "BRAIN" },
  { to: "/actions", icon: "actions", label: "ACTIONS" },
  { to: "/notes", icon: "notes", label: "NOTES" },
  { to: "/projects", icon: "projects", label: "PROJ" },
];

function RailLink({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex w-[52px] flex-col items-center gap-[3px] rounded-xl py-[7px] transition ` +
        (isActive
          ? "bg-[var(--cyan-2)] text-[var(--cyan)]"
          : "text-[var(--dim)] hover:bg-[var(--surf-2)] hover:text-[var(--bright)]")
      }
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none"
        stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        {RAIL_ICONS[icon]}
      </svg>
      <span className="text-[7.5px] tracking-[1.5px]">{label}</span>
    </NavLink>
  );
}

export function Layout() {
  useLive();
  useWorkerDelivery();
  return (
    <div className="flex h-full flex-col">
      <header className="z-10 flex items-center gap-4 border-b border-[var(--line)] bg-[var(--surf)] px-5 py-[10px]">
        <span className="flex items-center gap-2 font-[var(--display)] text-[15px] font-bold tracking-[3px] text-[var(--bright)] [font-family:var(--display)]">
          <span className="blip h-[8px] w-[8px] rounded-full bg-[var(--cyan)] shadow-[0_0_12px_var(--cyan)]" />
          KRONOS
        </span>
        <span className="text-[10.5px] tracking-widest text-[var(--dim)]">
          <b className="text-[var(--green)]">● ONLINE</b> · LOCAL
        </span>
        <HeaderVoice />
        <RecordingPill />
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex shrink-0 flex-col items-center gap-[6px] border-r border-[var(--line)] bg-[var(--surf)] px-[6px] py-3">
          {RAIL.map((r) => (
            <RailLink key={r.to} {...r} />
          ))}
          <div className="mt-auto">
            <RailLink to="/settings" icon="settings" label="SETUP" />
          </div>
        </aside>
        <main className="relative min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
