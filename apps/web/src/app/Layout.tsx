// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// App shell — redesign v2: top status header + left icon rail (D2).
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router-dom";
import { RecordingPill } from "../features/calls/RecordingPill";
import { HeaderVoice } from "../features/voice/HeaderVoice";
import { ThemeToggle } from "../components/ThemeToggle";
import { SearchBar } from "../components/SearchBar";
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

// ── the wordmark's mark ────────────────────────────────────────────────────
// Change MARK to try another. All three are drawn in the rail's convention —
// 24x24, stroked, currentColor — so the mark and the navigation read as one
// set rather than a logo bolted onto a UI.
//
// Note what the dot was doing: it pulses (`blip`), so it read as a liveness
// indicator, not decoration. An icon that merely sits there loses that, so the
// glow and the pulse are kept on the wrapper and the mark rides inside them.
const MARK: "core" | "brain" | "wave" = "brain";

const MARKS: Record<string, React.ReactNode> = {
    // concentric core — echoes the overview icon and the neural-core motif,
    // and stays legible at 16px where a detailed mark turns to mush
    core: (
        <>
            <circle cx="12" cy="12" r="8.5" />
            <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
        </>
    ),
    // the menu-bar mascot, for continuity with the Mac app
    // Lucide's "brain" (https://lucide.dev), ISC licensed — vendored as one
    // path set rather than pulling in the package, since this is the only icon
    // needed from it and the engine artifact ships its dependencies.
    //
    //   Copyright (c) for portions of Lucide are held by Cole Bemis
    //   2013-2022 as part of Feather (MIT). All other copyright (c) for
    //   Lucide are held by Lucide Contributors 2022. ISC License.
    //
    // It replaces a hand-drawn approximation: the Mac icon uses Apple's SF
    // Symbol "brain", whose artwork is licensed for Apple-platform apps and
    // cannot be shipped in a web page. Lucide is the honest way to get the
    // same mascot.
    brain: (
      <>
        <path d="M12 18V5" />
        <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
        <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
        <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
        <path d="M18 18a4 4 0 0 0 2-7.464" />
        <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
        <path d="M6 18a4 4 0 0 1-2-7.464" />
        <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
      </>
    ),
    // a spoken waveform — Jarvis is voice-first before it is anything else
    wave: (
        <path d="M3 12h2.2 M7.4 7.5v9 M11.7 4.5v15 M16 8.5v7 M20.3 10.8v2.4" />
    ),
};

function JarvisMark() {
    return (
        // 18px at Lucide's native stroke-width of 2. The brain is eight paths
        // in a 24-unit box; thinned to 1.8 and shrunk to 16px its folds close
        // up and it reads as a smudge. Detailed icons need their design weight.
        <span className="blip inline-flex h-[18px] w-[18px] items-center justify-center text-[var(--cyan)] [filter:drop-shadow(0_0_6px_var(--cyan-3))]">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {MARKS[MARK]}
            </svg>
        </span>
    );
}

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


// The installed version, where someone reporting a problem can find it without
// a terminal. Quiet by default — it is reference information, not status — and
// the tooltip carries the commit, which is what actually identifies a build
// when two installs claim the same tag.
function VersionTag() {
    const { data } = useQuery({
        queryKey: ["health"],
        queryFn: async () => (await fetch("/api/health")).json(),
        staleTime: Infinity,          // cannot change while the server is up
        retry: false,
    });
    const v = data?.version?.version;
    if (!v) return null;            // server down or too old to report it
    const commit = data?.version?.commit;
    return (
        <span
            title={commit ? `${v} · ${commit}` : v}
            className="select-all font-mono text-[8px] tracking-[0.5px] text-[var(--dim)] opacity-60 hover:opacity-100"
        >
            {v}
        </span>
    );
}

export function Layout() {
    useLive();
    useWorkerDelivery();
    return (
        <div className="flex h-full flex-col">
            <header className="z-10 flex items-center gap-4 border-b border-[var(--line)] bg-[var(--surf)] px-5 py-[10px]">
                <span className="flex items-center gap-2 font-[var(--display)] text-[15px] font-bold tracking-[3px] text-[var(--bright)] [font-family:var(--display)]">
                    <JarvisMark />
                    JARVIS
                </span>
                <SearchBar />
                <HeaderVoice />
                <RecordingPill />
                <div className="ml-auto flex items-center gap-3">
                    <span className="text-[10.5px] tracking-widest text-[var(--dim)]">
                        <b className="text-[var(--green)]">● ONLINE</b> · LOCAL
                    </span>
                    <ThemeToggle />
                </div>
            </header>
            <div className="flex min-h-0 flex-1">
                <aside className="flex shrink-0 flex-col items-center gap-[6px] border-r border-[var(--line)] bg-[var(--surf)] px-[6px] py-3">
                    {RAIL.map((r) => (
                        <RailLink key={r.to} {...r} />
                    ))}
                    <div className="mt-auto flex flex-col items-center gap-1">
                        <RailLink to="/settings" icon="settings" label="SETUP" />
                        <VersionTag />
                    </div>
                </aside>
                <main className="relative min-h-0 min-w-0 flex-1">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
