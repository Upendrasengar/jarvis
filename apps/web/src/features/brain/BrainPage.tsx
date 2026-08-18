// KRONOS second-brain graph — 3d-force-graph with Obsidian-style always-on
// labels; port of the legacy renderer including the slow camera orbit.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ForceGraph3D from "3d-force-graph";
import SpriteText from "three-spritetext";

// Two palettes — the WebGL scene can't read CSS variables, so mirror the
// theme here and swap live when the html.light class flips.
const isLight = () => document.documentElement.classList.contains("light");
// Group names come from the user's vault directory names (any number of
// them), so colors are assigned by rank: the biggest vault gets the
// signature cyan, then green, purple, amber, rose. "ref" (link targets
// with no page) stays deliberately muted.
const palette = () =>
  isLight()
    ? {
        bg: "#eef3fa",
        series: ["#0369a1", "#0c7f4d", "#7c3aed", "#9a6b00", "#c72e50"],
        ref: "#8fa6b8",
        label: "#22394f",
        link: "rgba(3,105,161,0.28)",
        particle: "#0369a1",
      }
    : {
        bg: "#04070f",
        series: ["#39d7ff", "#3ee08a", "#c792ea", "#ffcf5c", "#ff8fa3"],
        ref: "#2a3a4a",
        label: "#cfe8ff",
        link: "rgba(57,215,255,0.22)",
        particle: "#39d7ff",
      };

export function BrainPage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState("loading…");
  const navigate = useNavigate();

  useEffect(() => {
    const wrap = wrapRef.current!;
    let graph: any = null;
    let orbiting = true;
    let cancelled = false;
    let pal = palette();
    // group → palette rank, filled in once the data arrives (biggest first)
    let groupRank = new Map<string, number>();
    const colorFor = (g: string) =>
      g === "ref" ? pal.ref : pal.series[(groupRank.get(g) ?? 0) % pal.series.length];

    const makeSprite = (n: any) => {
      const s = new SpriteText(n.id);
      s.color = colorFor(n.group);
      s.textHeight = 2.6 + Math.min(n.deg ?? 0, 16) * 0.4;
      s.fontWeight = "600";
      s.position.set(0, -(5 + Math.min(n.deg ?? 0, 14) * 0.6), 0);
      s.material.depthWrite = false;
      s.material.depthTest = false;
      s.renderOrder = 10;
      return s;
    };

    // follow the theme switcher without a page reload
    const mo = new MutationObserver(() => {
      pal = palette();
      graph
        ?.backgroundColor(pal.bg)
        .nodeColor((n: any) => colorFor(n.group))
        .linkColor(() => pal.link)
        .linkDirectionalParticleColor(() => pal.particle)
        .nodeThreeObject((n: any) => makeSprite(n));   // new identity → sprites rebuild
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    (async () => {
      const data = await (await fetch("/api/graph")).json();
      if (cancelled) return;
      const counts: Record<string, number> = {};
      for (const n of data.nodes)
        if (n.group !== "ref") counts[n.group] = (counts[n.group] ?? 0) + 1;
      const ordered = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      groupRank = new Map(ordered.map((g, i) => [g, i]));
      setStats(`${data.nodes.length} notes · ${data.links.length} links · ${ordered.length} vaults`);

      const probe = document.createElement("canvas");
      if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) {
        setStats("⚠ WebGL unavailable — close some 3D tabs and revisit.");
        return;
      }

      graph = new ForceGraph3D(wrap)
        .graphData(data)
        .backgroundColor(pal.bg)
        .nodeColor((n: any) => colorFor(n.group))
        .nodeRelSize(3)
        .nodeVal((n: any) => 0.6 + Math.min(n.deg ?? 0, 14) * 0.4)
        .nodeOpacity(0.9)
        .nodeThreeObjectExtend(true)
        .nodeThreeObject((n: any) => makeSprite(n))
        .linkColor(() => pal.link)
        .linkOpacity(0.4)
        .linkDirectionalParticles(1)
        .linkDirectionalParticleWidth(1.4)
        .linkDirectionalParticleColor(() => pal.particle)
        .onNodeClick((n: any) => {
          // legacy behavior: clicking a note asks Jarvis about it
          sessionStorage.setItem(
            "jarvis_pending",
            JSON.stringify({ text: `Tell me about ${n.id}`, voice: false }),
          );
          navigate("/chat");
        });
      graph.d3Force("charge")?.strength(-70);

      let angle = 0;
      const orbit = () => {
        if (!orbiting || !graph) return;
        angle += 0.0016;
        graph.cameraPosition({ x: 340 * Math.sin(angle), z: 340 * Math.cos(angle) });
        requestAnimationFrame(orbit);
      };
      orbit();
    })();

    return () => {
      cancelled = true;
      orbiting = false;
      mo.disconnect();
      graph?._destructor?.();
      wrap.innerHTML = "";
    };
  }, []);

  return (
    <div className="relative h-full">
      <div className="absolute left-5 top-4 z-[5]">
        <div className="font-bold tracking-[2px] text-[var(--cyan)] [text-shadow:0_0_14px_var(--node-glow-h)]">
          KRONOS · SECOND BRAIN
        </div>
        <div className="text-[11px] text-[var(--dim)]">{stats}</div>
      </div>
      <div ref={wrapRef} className="h-full" />
    </div>
  );
}
