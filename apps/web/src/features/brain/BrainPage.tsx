// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// KRONOS second-brain graph — 3d-force-graph with Obsidian-style always-on
// labels, plus an Obsidian-style control panel: filters (search, orphans),
// display (node size, link width, labels, arrows), forces (repel, distance).
// Control state persists in localStorage.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
  tags: boolean;        // show #tag nodes from frontmatter
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
  search: "", orphans: true, tags: false, hiddenGroups: [], nodeSize: 3, linkWidth: 1,
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
  // space-separated terms AND together, Obsidian-style: each is either
  // "tag:design" (matches notes carrying that tag; shows the tag node even
  // when the Tags toggle is off) or plain text (id substring)
  const terms = ctl.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const tagTerms = terms.filter((t) => t.startsWith("tag:")).map((t) => "#" + t.slice(4).replace(/^#/, ""));
  const textTerms = terms.filter((t) => !t.startsWith("tag:"));
  if (!ctl.tags && !tagTerms.length) nodes = nodes.filter((n) => n.group !== "tag");
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
  if (terms.length) {
    // notes carrying EVERY tag term (per-tag membership from the link table)
    const taggedSets = tagTerms.map((tq) => {
      const set = new Set<string>();
      for (const l of data.links) if (String(idOf(l.target)).toLowerCase() === tq) set.add(idOf(l.source));
      return set;
    });
    const hits = new Set(
      nodes.filter((n) => {
        const id = String(n.id).toLowerCase();
        if (tagTerms.includes(id)) return true;               // the tag nodes themselves
        if (!textTerms.every((t) => id.includes(t))) return false;
        return taggedSets.every((set) => set.has(n.id));
      }).map((n) => n.id),
    );
    const keep = new Set(hits);
    // matches + one-hop neighborhood — but with 2+ tags, don't expand through
    // the tag nodes, or the union of both tags floods the intersection
    const expandFrom = (id: string) => !(tagTerms.length > 1 && String(id).startsWith("#"));
    for (const l of data.links) {
      if (hits.has(idOf(l.source)) && expandFrom(idOf(l.source))) keep.add(idOf(l.target));
      if (hits.has(idOf(l.target)) && expandFrom(idOf(l.target))) keep.add(idOf(l.source));
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
  const [params] = useSearchParams();
  const focus = params.get("focus") ?? "";
  const [ctl, setCtl] = useState<Controls>(() => ({ ...loadControls(), search: focus }));
  const [vaults, setVaults] = useState<string[]>([]);
  const [sel, setSel] = useState<{ id: string; group: string; path?: string; deg?: number } | null>(null);
  useEffect(() => { if (focus) setCtl((c) => ({ ...c, search: focus })); }, [focus]);
  const [panelOpen, setPanelOpen] = useState(true);
  const navigate = useNavigate();
  const graphRef = useRef<any>(null);
  const dataRef = useRef<any>(null);
  const ctlRef = useRef(ctl);
  ctlRef.current = ctl;
  const palRef = useRef(palette());
  const rankRef = useRef(new Map<string, number>());

  // selection highlight (Obsidian-style): the picked node keeps its color,
  // neighbors stay lit, everything else fades to a ghost
  const selRef = useRef<{ id: string } | null>(null);
  const neighRef = useRef<Set<string>>(new Set());

  const colorFor = (g: string) =>
    g === "ref" ? palRef.current.ref
      : g === "tag" ? "#34d399"
      : palRef.current.series[(rankRef.current.get(g) ?? 0) % palRef.current.series.length];

  const lit = (id: string) => {
    const s = selRef.current;
    return !s || id === s.id || neighRef.current.has(id);
  };
  const nodeCol = (n: any) => (lit(n.id) ? colorFor(n.group) : "rgba(138,140,158,0.35)");
  const linkCol = (l: any) => {
    const s = selRef.current;
    if (!s) return palRef.current.link;
    return idOf(l.source) === s.id || idOf(l.target) === s.id ? "#7c83ff" : "rgba(138,140,158,0.14)";
  };
  const arrowLen = (l: any) => {
    const s = selRef.current;
    if (s && (idOf(l.source) === s.id || idOf(l.target) === s.id)) return 5.5;
    return ctlRef.current.arrows ? 3.5 : 0;
  };
  const linkW = (l: any) => {
    const s = selRef.current;
    const base = ctlRef.current.linkWidth;
    if (!s) return base;
    return idOf(l.source) === s.id || idOf(l.target) === s.id ? base + 0.8 : base * 0.4;
  };

  const makeSprite = (n: any) => {
    if (ctlRef.current.labelSize <= 0) return null as any;   // labels off
    if (!lit(n.id)) return null as any;                      // faded nodes lose labels too
    const s = new SpriteText(n.id);
    s.color = colorFor(n.group);
    const em = selRef.current && n.id === selRef.current.id ? 1.35 : 1;
    s.textHeight = (2.6 + Math.min(n.deg ?? 0, 16) * 0.4) * ctlRef.current.labelSize * em;
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
        .nodeColor(nodeCol)
        .linkColor(linkCol)
        .linkDirectionalParticleColor(() => palRef.current.particle)
        .nodeThreeObject((n: any) => makeSprite(n));
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const ro = new ResizeObserver(() => {
      graphRef.current?.width(wrap.clientWidth).height(wrap.clientHeight);
    });

    (async () => {
      const data = await (await fetch("/api/graph")).json();
      if (cancelled) return;
      dataRef.current = data;
      const counts: Record<string, number> = {};
      for (const n of data.nodes)
        if (n.group !== "ref" && n.group !== "tag") counts[n.group] = (counts[n.group] ?? 0) + 1;
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
        .width(wrap.clientWidth)
        .height(wrap.clientHeight)
        .graphData(filterData(data, c))
        .backgroundColor(pal.bg)
        .nodeColor(nodeCol)
        .nodeRelSize(c.nodeSize)
        .nodeVal((n: any) => 0.6 + Math.min(n.deg ?? 0, 14) * 0.4)
        .nodeOpacity(0.9)
        .nodeThreeObjectExtend(true)
        .nodeThreeObject((n: any) => makeSprite(n))
        .linkColor(linkCol)
        .linkOpacity(0.4)
        .linkWidth(linkW)
        .linkDirectionalArrowLength(arrowLen)
        .linkDirectionalArrowRelPos(1)
        .linkDirectionalParticles(1)
        .linkDirectionalParticleWidth(1.4)
        .linkDirectionalParticleColor(() => pal.particle)
        .onNodeClick((n: any) =>
          // select → the readout card offers the type-appropriate actions;
          // navigation only happens when one is chosen
          setSel({ id: n.id, group: n.group, path: n.path, deg: n.deg }))
        .onBackgroundClick(() => setSel(null));
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

      // the canvas defaults to WINDOW size — with the icon rail the content
      // area is narrower, so track the container instead of the window
      ro.observe(wrap);
    })();

    return () => {
      cancelled = true;
      orbiting = false;
      ro.disconnect();
      mo.disconnect();
      graphRef.current?._destructor?.();
      graphRef.current = null;
      wrap.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // apply control changes to the live graph (re-layout only when the node
  // set actually changes — slider moves shouldn't reshuffle the universe)
  const prevFilter = useRef({ search: ctl.search, orphans: ctl.orphans, tags: ctl.tags, hidden: ctl.hiddenGroups.join() });
  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...ctl, search: "" }));
    const g = graphRef.current;
    if (!g) return;
    g.nodeRelSize(ctl.nodeSize)
      .linkWidth(linkW)
      .linkDirectionalArrowLength(arrowLen)
      .nodeThreeObject((n: any) => makeSprite(n));
    g.d3Force("charge")?.strength(-ctl.repel);
    g.d3Force("link")?.distance(ctl.linkDist);
    const hidden = ctl.hiddenGroups.join();
    if (prevFilter.current.search !== ctl.search || prevFilter.current.orphans !== ctl.orphans ||
        prevFilter.current.tags !== ctl.tags || prevFilter.current.hidden !== hidden) {
      prevFilter.current = { search: ctl.search, orphans: ctl.orphans, tags: ctl.tags, hidden };
      if (dataRef.current) g.graphData(filterData(dataRef.current, ctl));
    }
    g.d3ReheatSimulation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl]);

  // restyle on selection change — no re-layout, just colors/labels/widths
  useEffect(() => {
    selRef.current = sel;
    const nb = new Set<string>();
    if (sel && dataRef.current)
      for (const l of dataRef.current.links) {
        if (idOf(l.source) === sel.id) nb.add(idOf(l.target));
        if (idOf(l.target) === sel.id) nb.add(idOf(l.source));
      }
    neighRef.current = nb;
    graphRef.current
      ?.nodeColor(nodeCol)
      .linkColor(linkCol)
      .linkWidth(linkW)
      .linkDirectionalArrowLength(arrowLen)
      .nodeThreeObject((n: any) => makeSprite(n));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const set = (patch: Partial<Controls>) => setCtl((c) => ({ ...c, ...patch }));

  // readout actions — routes by node kind
  const selKind = !sel ? "" :
    sel.group === "tag" ? "tag" :
    /^call(-notes)?-\d{4}-\d{2}-\d{2}-\d{4}$/.test(sel.id) ? "call" :
    sel.path?.includes("/Notes/") ? "note" :
    sel.path?.includes("/Topics/") ? "topic" :
    sel.group === "ref" ? "ref" : "note-ish";
  const openSel = () => {
    if (!sel) return;
    if (selKind === "call") navigate(`/calls/${sel.id.replace(/^call(-notes)?-/, "")}`);
    else navigate(`/notes/${encodeURIComponent(sel.id)}`);
  };
  const focusSel = () => {
    if (!sel) return;
    set({ search: selKind === "tag" ? `tag:${sel.id.replace(/^#/, "")}` : sel.id });
    setSel(null);
  };
  const askSel = () => {
    if (!sel) return;
    const text = selKind === "tag"
      ? `Tell me about the ${sel.id} tag from my knowledge graph. Search my vault ` +
        `for notes whose frontmatter tags include "${sel.id.replace(/^#/, "")}", then ` +
        `give me the full picture: what this theme covers, recent activity, open action items.`
      : `Tell me about "${sel.id}" from my knowledge graph. ` +
        (sel.path ? `Its page is at ${sel.path}. ` : `It has no page of its own — only links point to it. `) +
        `Read that page and search my vaults for the literal text [[${sel.id}]] ` +
        `to gather every call and note linking to it, then give me the full picture: ` +
        `what it is, recent activity, open action items.`;
    sessionStorage.setItem("jarvis_pending", JSON.stringify({ text, voice: false }));
    navigate("/chat");
  };

  return (
    <div className="relative h-full overflow-hidden">
      {sel && (
        <div className="absolute bottom-6 left-5 z-[6] w-[240px] rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-3 [box-shadow:var(--shadow)]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[9px] tracking-[2px] text-[var(--dim)]">
                {selKind === "tag" ? "TAG" : selKind === "call" ? "CALL" : selKind === "topic" ? "TOPIC"
                  : selKind === "note" ? "NOTE" : "NODE"}
                {typeof sel.deg === "number" ? ` · ${sel.deg} LINKS` : ""}
              </div>
              <div className="truncate text-[13px] font-semibold text-[var(--bright)]" title={sel.id}>{sel.id}</div>
            </div>
            <button onClick={() => setSel(null)} className="text-[var(--dim)] hover:text-[var(--red)]">×</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(selKind === "call" || selKind === "note" || selKind === "note-ish") && (
              <button onClick={openSel}
                className="rounded-full border border-[var(--cyan-3)] px-[10px] py-[3px] text-[10px] text-[var(--cyan)] hover:border-[var(--cyan)]">
                OPEN
              </button>
            )}
            <button onClick={focusSel}
              className="rounded-full border border-[var(--indigo-3)] px-[10px] py-[3px] text-[10px] text-[var(--indigo)] hover:border-[var(--indigo)]">
              FOCUS
            </button>
            <button onClick={askSel}
              className="rounded-full border border-[var(--line)] px-[10px] py-[3px] text-[10px] text-[var(--text)] hover:border-[var(--bright)]">
              ASK JARVIS
            </button>
          </div>
        </div>
      )}
      <div className="absolute left-5 top-4 z-[5]">
        <div className="font-bold tracking-[2px] text-[var(--indigo)] [font-family:var(--display)] [text-shadow:0_0_14px_var(--indigo-3)]">
          JARVIS · SECOND BRAIN
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
              placeholder="Search… tag:design tag:team"
              className="w-full rounded-md border border-[var(--line)] bg-[var(--surf-2)] px-2 py-1 text-[11.5px] text-[var(--text)] outline-none placeholder:text-[var(--dim)] focus:border-[var(--indigo-3)]"
            />
            <Toggle label="Orphans" value={ctl.orphans} onChange={(v) => set({ orphans: v })} />
            <Toggle label="Tags" value={ctl.tags} onChange={(v) => set({ tags: v })} />
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
