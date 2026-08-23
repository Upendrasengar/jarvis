// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// The overview centerpiece: a swappable "core" visual (particles / arc
// reactor / oculus — localStorage-selected, styles added never replaced)
// with capability satellites styled after the HUD mockup: circled line
// icons, labels, dashed connectors toward the ring, JARVIS badge below.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ParticleCore, type CoreStatus } from "./ParticleCore";
import { ArcReactorCore } from "./ArcReactorCore";

type CoreStyle = "particles" | "reactor" | "eye";

const ICONS: Record<string, React.ReactNode> = {
  digest: <path d="M7 3h7l3 3v15H7z M10 9h5 M10 13h5 M10 17h3" />,
  chat: <path d="M4 5h16v11H10l-5 4v-4H4z" />,
  calls: <path d="M6 4c0 8 6 14 14 14l1-4-4-1.5-1.5 1.5c-3-1.2-5.3-3.5-6.5-6.5L10.5 6 9 2z" />,
  actions: <path d="M13 2 6 14h5l-1 8 7-12h-5z" />,
  brain: <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 6V3 M12 21v-3 M6 12H3 M21 12h-3 M6.5 6.5 5 5 M19 19l-1.5-1.5 M17.5 6.5 19 5 M5 19l1.5-1.5" />,
  projects: <path d="M3 6h6l2 2h10v11H3z" />,
  settings: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M5 19l2-2" />,
  jarvis: <path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />,
};

const SATELLITES: Array<{ label: string; icon: string; to: string; angle: number }> = [
  { label: "DIGEST", icon: "digest", to: "/digest", angle: -90 },
  { label: "SETTINGS", icon: "settings", to: "/settings", angle: -138 },
  { label: "CHAT", icon: "chat", to: "/chat", angle: -42 },
  { label: "PROJECTS", icon: "projects", to: "/projects", angle: 180 },
  { label: "CALLS", icon: "calls", to: "/calls", angle: 0 },
  { label: "BRAIN", icon: "brain", to: "/brain", angle: 138 },
  { label: "ACTIONS", icon: "actions", to: "/actions", angle: 42 },
];

const RX = 36, RY = 43;          // satellite ellipse (percent radii)
const RX_IN = 26, RY_IN = 31;    // connector inner endpoint

function Icon({ name, size = 17 }: { name: string; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}

export function NeuralCore({ status }: { status: CoreStatus }) {
  const [style, setStyle] = useState<CoreStyle>(
    () => (localStorage.getItem("jarvis_core_style") as CoreStyle) || "particles",
  );
  const navigate = useNavigate();

  const pick = (s: CoreStyle) => {
    setStyle(s);
    localStorage.setItem("jarvis_core_style", s);
  };

  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-x-0 top-1 z-[1] text-center text-[10px] tracking-[3px] text-[var(--dim)]">
        NEURAL CORE · JARVIS
      </div>

      {style === "particles" ? (
        <ParticleCore status={status} />
      ) : (
        <ArcReactorCore status={status} center={style === "eye" ? "eye" : "glow"} />
      )}

      {/* dashed connectors: satellite → ring */}
      <svg
        className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {SATELLITES.map((s) => {
          const rad = (s.angle * Math.PI) / 180;
          return (
            <line
              key={s.label}
              x1={50 + Math.cos(rad) * (RX - 4)}
              y1={50 + Math.sin(rad) * (RY - 5)}
              x2={50 + Math.cos(rad) * RX_IN}
              y2={50 + Math.sin(rad) * RY_IN}
              stroke="var(--node-line)"
              strokeWidth={1}
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      {SATELLITES.map((s) => {
        const rad = (s.angle * Math.PI) / 180;
        const xPct = 50 + Math.cos(rad) * RX;
        const yPct = 50 + Math.sin(rad) * RY;
        return (
          <button
            key={s.label}
            onClick={() => navigate(s.to)}
            style={{ left: `${xPct}%`, top: `${yPct}%` }}
            className="group absolute z-[2] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--node-border)] bg-[var(--chipbg)] text-[var(--cyan)] shadow-[0_0_14px_var(--node-glow)] backdrop-blur transition group-hover:shadow-[0_0_22px_var(--node-glow-h)]">
              <Icon name={s.icon} />
            </span>
            <span className="text-[9.5px] font-semibold tracking-[2px] text-[var(--text)] opacity-80 transition group-hover:text-[var(--cyan)] group-hover:opacity-100">
              {s.label}
            </span>
          </button>
        );
      })}

      {/* JARVIS badge, bottom center — the identity mark from the mockup */}
      <div className="absolute bottom-6 left-1/2 z-[2] flex -translate-x-1/2 flex-col items-center gap-1">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--node-border)] bg-[var(--chipbg)] text-[var(--cyan)] shadow-[0_0_14px_var(--node-glow)] backdrop-blur">
          <Icon name="jarvis" />
        </span>
        <span className="text-[9px] tracking-[3px] text-[var(--dim)]">JARVIS</span>
      </div>

      {/* core style switcher — new styles get added, old ones never deleted */}
      <div className="absolute bottom-2 left-1/2 z-[2] flex -translate-x-1/2 gap-1">
        {(["particles", "reactor", "eye"] as CoreStyle[]).map((s) => (
          <button
            key={s}
            onClick={() => pick(s)}
            title={s === "reactor" ? "Arc reactor core" : s === "eye" ? "Oculus core" : "Particle core"}
            className={`h-[8px] w-[8px] rounded-full border transition ${
              style === s
                ? "border-[var(--cyan)] bg-[var(--cyan)] shadow-[0_0_8px_var(--cyan)]"
                : "border-[var(--dim)] opacity-50 hover:opacity-100"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
