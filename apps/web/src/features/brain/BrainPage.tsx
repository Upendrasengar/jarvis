// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// KRONOS second-brain graph — 3d-force-graph with Obsidian-style always-on
// labels, plus an Obsidian-style control panel: filters (search, orphans),
// display (node size, link width, labels, arrows), forces (repel, distance).
// Control state persists in localStorage.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ForceGraph3D from "3d-force-graph";
import SpriteText from "three-spritetext";

// Two palettes — the WebGL scene can't read CSS variables, so mirror the
// theme here and swap live when the html.light class flips.
const isLight = () => document.documentElement.classList.contains("light");
// Group names come from the user's vault directory names (any number of
// them), so colors are assigned by rank: the biggest vault gets the
// indigo knowledge accent (cyan stays reserved for live surfaces), then
// cyan, green, amber, rose. "ref" (link targets with no page) stays muted.
const palette = () =>
  isLight()
    ? {
        bg: "#eef2f7",
        series: ["#4f5bd5", "#0e7490", "#0c7f4d", "#8a5a00", "#bd2f4d"],
        ref: "#8fa6b8",
        label: "#17222f",
        link: "rgba(79,91,213,0.30)",
        particle: "#4f5bd5",
      }
    : {
        bg: "#060a11",
        series: ["#8b93ff", "#22d3ee", "#35d99b", "#ffc95c", "#ff6b84"],
        ref: "#2a3a4a",
        label: "#d5e2f0",
        link: "rgba(139,147,255,0.24)",
        particle: "#8b93ff",
      };

type Controls = {
  search: string;
  orphans: boolean;     // show notes with no links
  hiddenGroups: string[];   // vaults toggled off in the Filters section
  nodeSize: number;     // 1..8
  linkWidth: number;    // 0..3
  labelSize: number;    // 0..2 (0 = hide labels)
  arrows: boolean;
  motion: boolean;      // slow camera orbit
  repel: number;        // 10..250 (applied negative)
  linkDist: number;     // 10..150
};
const DEFAULTS: Controls = {
  search: "", orphans: true, hiddenGroups: [], nodeSize: 3, linkWidth: 1,
  labelSize: 1, arrows: false, motion: true, repel: 70, linkDist: 40,
};
const STORE_KEY = "jarvis_brain_controls";
function loadControls(): Controls {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}"), search: "" }; }
  catch { return DEFAULTS; }
}

const idOf = (x: any) => (typeof x === "object" && x !== null ? x.id : x);

function filterData(data: any, ctl: Controls) {
  let nodes = data.nodes as any[];
  if (ctl.hiddenGroups.length) {
    const hidden = new Set(ctl.hiddenGroups);
    // "ref" nodes belong to no vault — they survive as long as any vault shows
    nodes = nodes.filter((n) => !hidden.has(n.group));
  }
  if (!ctl.orphans) {
    const linked = new Set<string>();
    for (const l of data.links) { linked.add(idOf(l.source)); linked.add(idOf(l.target)); }
    nodes = nodes.filter((n) => linked.has(n.id));
  }
  const q = ctl.search.trim().toLowerCase();
  if (q) {
    const hits = new Set(nodes.filter((n) => String(n.id).toLowerCase().includes(q)).map((n) => n.id));
    const keep = new Set(hits);
    for (const l of data.links) {          // matches + one-hop neighborhood
      if (hits.has(idOf(l.source))) keep.add(idOf(l.target));
      if (hits.has(idOf(l.target))) keep.add(idOf(l.source));
    }
    nodes = nodes.filter((n) => keep.has(n.id));
  }
  const ids = new Set(nodes.map((n) => n.id));
  const links = data.links.filter((l: any) => ids.has(idOf(l.source)) && ids.has(idOf(l.target)));
  return { nodes, links };
}

function Slider({ label, min, max, step, value, onChange }: {
  label: string; min: number; max: number; step: number; value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-[2px] flex justify-between text-[10px] text-[var(--dim)]">
        <span>{label}</span><span>{value}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--indigo)]"
      />
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-[11px] text-[var(--text)]">
      {label}
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--indigo)]" />
    </label>
  );
}

export function BrainPage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState("loading…");
  const [ctl, setCtl] = useState<Controls>(loadControls);
  const [vaults, setVaults] = useState<string[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const navigate = useNavigate();
  const graphRef = useRef<any>(null);
  const dataRef = useRef<any>(null);
  const ctlRef = useRef(ctl);
  ctlRef.current = ctl;
  const palRef = useRef(palette());
  const rankRef = useRef(new Map<string, number>());

  const colorFor = (g: string) =>
    g === "ref" ? palRef.current.ref
      : palRef.current.series[(rankRef.current.get(g) ?? 0) % palRef.current.series.length];

  const makeSprite = (n: any) => {
    if (ctlRef.current.labelSize <= 0) return null as any;   // labels off
    const s = new SpriteText(n.id);
    s.color = colorFor(n.group);
    s.textHeight = (2.6 + Math.min(n.deg ?? 0, 16) * 0.4) * ctlRef.current.labelSize;
    s.fontWeight = "600";
    s.position.set(0, -(5 + Math.min(n.deg ?? 0, 14) * 0.6), 0);
    s.material.depthWrite = false;
    s.material.depthTest = false;
    s.renderOrder = 10;
    return s;
  };

  useEffect(() => {
    const wrap = wrapRef.current!;
    let orbiting = true;
    let cancelled = false;

    // follow the theme switcher without a page reload
    const mo = new MutationObserver(() => {
      palRef.current = palette();
      graphRef.current
        ?.backgroundColor(palRef.current.bg)
        .nodeColor((n: any) => colorFor(n.group))
        .linkColor(() => palRef.current.link)
        .linkDirectionalParticleColor(() => palRef.current.particle)
        .nodeThreeObject((n: any) => makeSprite(n));
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    (async () => {
      const data = await (await fetch("/api/graph")).json();
      if (cancelled) return;
      dataRef.current = data;
      const counts: Record<string, number> = {};
      for (const n of data.nodes)
        if (n.group !== "ref") counts[n.group] = (counts[n.group] ?? 0) + 1;
      const ordered = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      rankRef.current = new Map(ordered.map((g, i) => [g, i]));
      setVaults(ordered);
      setStats(`${data.nodes.length} notes · ${data.links.length} links · ${ordered.length} vaults`);

      const probe = document.createElement("canvas");
      if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) {
        setStats("⚠ WebGL unavailable — close some 3D tabs and revisit.");
        return;
      }

      const c = ctlRef.current;
      const pal = palRef.current;
      const graph = new ForceGraph3D(wrap)
        .graphData(filterData(data, c))
        .backgroundColor(pal.bg)
        .nodeColor((n: any) => colorFor(n.group))
        .nodeRelSize(c.nodeSize)
        .nodeVal((n: any) => 0.6 + Math.min(n.deg ?? 0, 14) * 0.4)
        .nodeOpacity(0.9)
        .nodeThreeObjectExtend(true)
        .nodeThreeObject((n: any) => makeSprite(n))
        .linkColor(() => pal.link)
        .linkOpacity(0.4)
        .linkWidth(c.linkWidth)
        .linkDirectionalArrowLength(c.arrows ? 3.5 : 0)
        .linkDirectionalArrowRelPos(1)
        .linkDirectionalParticles(1)
        .linkDirectionalParticleWidth(1.4)
        .linkDirectionalParticleColor(() => pal.particle)
        .onNodeClick((n: any) => {
          // clicking a node asks Jarvis about it — with enough context that
          // the ask-worker goes straight to the node's page and its wikilink
          // cluster instead of guessing what "X" refers to
          const where = n.path
            ? `Its page is at ${n.path}.`
            : `It has no page of its own — only links point to it.`;
          sessionStorage.setItem(
            "jarvis_pending",
            JSON.stringify({
              text:
                `Tell me about "${n.id}" from my knowledge graph. ${where} ` +
                `Read that page and search my vaults for the literal text [[${n.id}]] ` +
                `to gather every call and note linking to it, then give me the full picture: ` +
                `what it is, recent activity, open action items.`,
              voice: false,
            }),
          );
          navigate("/chat");
        });
      graph.d3Force("charge")?.strength(-c.repel);
      graph.d3Force("link")?.distance(c.linkDist);
      graphRef.current = graph;

      // orbit keeps ticking while mounted; the motion toggle gates whether it
      // actually moves the camera, so pausing frees the mouse for manual
      // rotation and resuming picks up where it left off
      let angle = 0;
      const orbit = () => {
        if (!orbiting || !graphRef.current) return;
        if (ctlRef.current.motion) {
          angle += 0.0016;
          graphRef.current.cameraPosition({ x: 340 * Math.sin(angle), z: 340 * Math.cos(angle) });
        }
        requestAnimationFrame(orbit);
      };
      orbit();
    })();

    return () => {
      cancelled = true;
      orbiting = false;
      mo.disconnect();
      graphRef.current?._destructor?.();
      graphRef.current = null;
      wrap.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // apply control changes to the live graph (re-layout only when the node
  // set actually changes — slider moves shouldn't reshuffle the universe)
  const prevFilter = useRef({ search: ctl.search, orphans: ctl.orphans, hidden: ctl.hiddenGroups.join() });
  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...ctl, search: "" }));
    const g = graphRef.current;
    if (!g) return;
    g.nodeRelSize(ctl.nodeSize)
      .linkWidth(ctl.linkWidth)
      .linkDirectionalArrowLength(ctl.arrows ? 3.5 : 0)
      .nodeThreeObject((n: any) => makeSprite(n));
    g.d3Force("charge")?.strength(-ctl.repel);
    g.d3Force("link")?.distance(ctl.linkDist);
    const hidden = ctl.hiddenGroups.join();
    if (prevFilter.current.search !== ctl.search || prevFilter.current.orphans !== ctl.orphans ||
        prevFilter.current.hidden !== hidden) {
      prevFilter.current = { search: ctl.search, orphans: ctl.orphans, hidden };
      if (dataRef.current) g.graphData(filterData(dataRef.current, ctl));
    }
    g.d3ReheatSimulation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl]);

  const set = (patch: Partial<Controls>) => setCtl((c) => ({ ...c, ...patch }));

  return (
    <div className="relative h-full">
      <div className="absolute left-5 top-4 z-[5]">
        <div className="font-bold tracking-[2px] text-[var(--indigo)] [font-family:var(--display)] [text-shadow:0_0_14px_var(--indigo-3)]">
          KRONOS · SECOND BRAIN
        </div>
        <div className="text-[11px] text-[var(--dim)]">{stats}</div>
      </div>

      {/* Obsidian-style controls */}
      <div className="absolute right-4 top-4 z-[6] w-[230px] rounded-2xl border border-[var(--line)] bg-[var(--surf)] [box-shadow:var(--shadow)]">
        <div className="flex items-center justify-between px-3 py-2">
          <button onClick={() => setPanelOpen(!panelOpen)}
            className="text-[10px] tracking-[2px] text-[var(--indigo)]">
            {panelOpen ? "▾" : "▸"} GRAPH CONTROLS
          </button>
          {panelOpen && (
            <button title="Reset to defaults" onClick={() => setCtl({ ...DEFAULTS })}
              className="text-[11px] text-[var(--dim)] hover:text-[var(--indigo)]">↺</button>
          )}
        </div>
        {panelOpen && (
          <div className="space-y-3 px-3 pb-3">
            <input
              value={ctl.search}
              onChange={(e) => set({ search: e.target.value })}
              placeholder="Search notes…"
              className="w-full rounded-md border border-[var(--line)] bg-[var(--surf-2)] px-2 py-1 text-[11.5px] text-[var(--text)] outline-none placeholder:text-[var(--dim)] focus:border-[var(--indigo-3)]"
            />
            <Toggle label="Orphans" value={ctl.orphans} onChange={(v) => set({ orphans: v })} />
            {vaults.length > 1 && (
              <div className="space-y-1">
                <div className="text-[9px] tracking-[2px] text-[var(--dim)]">VAULTS</div>
                {vaults.map((v) => (
                  <label key={v} className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text)]">
                    <input
                      type="checkbox"
                      checked={!ctl.hiddenGroups.includes(v)}
                      onChange={(e) =>
                        set({
                          hiddenGroups: e.target.checked
                            ? ctl.hiddenGroups.filter((g) => g !== v)
                            : [...ctl.hiddenGroups, v],
                        })
                      }
                      className="accent-[var(--indigo)]"
                    />
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorFor(v) }} />
                    <span className="truncate">{v}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="border-t border-[var(--line)] pt-2 text-[9px] tracking-[2px] text-[var(--dim)]">DISPLAY</div>
            <Toggle label="Motion (orbit)" value={ctl.motion} onChange={(v) => set({ motion: v })} />
            <Toggle label="Arrows" value={ctl.arrows} onChange={(v) => set({ arrows: v })} />
            <Slider label="Node size" min={1} max={8} step={0.5} value={ctl.nodeSize} onChange={(v) => set({ nodeSize: v })} />
            <Slider label="Link thickness" min={0} max={3} step={0.25} value={ctl.linkWidth} onChange={(v) => set({ linkWidth: v })} />
            <Slider label="Text size" min={0} max={2} step={0.25} value={ctl.labelSize} onChange={(v) => set({ labelSize: v })} />
            <div className="border-t border-[var(--line)] pt-2 text-[9px] tracking-[2px] text-[var(--dim)]">FORCES</div>
            <Slider label="Repel force" min={10} max={250} step={10} value={ctl.repel} onChange={(v) => set({ repel: v })} />
            <Slider label="Link distance" min={10} max={150} step={5} value={ctl.linkDist} onChange={(v) => set({ linkDist: v })} />
          </div>
        )}
      </div>

      <div ref={wrapRef} className="h-full" />
    </div>
  );
}
