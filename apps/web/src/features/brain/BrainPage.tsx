// KRONOS second-brain graph — 3d-force-graph with Obsidian-style always-on
// labels; port of the legacy renderer including the slow camera orbit.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ForceGraph3D from "3d-force-graph";
import SpriteText from "three-spritetext";

// Two palettes — the WebGL scene can't read CSS variables, so mirror the
// theme here and swap live when the html.light class flips.
const isLight = () => document.documentElement.classList.contains("light");
const palette = () =>
  isLight()
    ? {
        bg: "#eef3fa",
        colors: { work: "#0369a1", projects: "#0c7f4d", ref: "#8fa6b8" } as Record<string, string>,
        label: "#22394f",
        link: "rgba(3,105,161,0.28)",
        particle: "#0369a1",
      }
    : {
        bg: "#04070f",
        colors: { work: "#39d7ff", projects: "#3ee08a", ref: "#2a3a4a" } as Record<string, string>,
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

    const makeSprite = (n: any) => {
      const s = new SpriteText(n.id);
      s.color = pal.colors[n.group] ?? pal.label;
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
        .nodeColor((n: any) => pal.colors[n.group] ?? "#888")
        .linkColor(() => pal.link)
        .linkDirectionalParticleColor(() => pal.particle)
        .nodeThreeObject((n: any) => makeSprite(n));   // new identity → sprites rebuild
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    (async () => {
      const data = await (await fetch("/api/graph")).json();
      if (cancelled) return;
      setStats(`${data.nodes.length} notes · ${data.links.length} links · 2 vaults`);

      const probe = document.createElement("canvas");
      if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) {
        setStats("⚠ WebGL unavailable — close some 3D tabs and revisit.");
        return;
      }

      graph = new ForceGraph3D(wrap)
        .graphData(data)
        .backgroundColor(pal.bg)
        .nodeColor((n: any) => pal.colors[n.group] ?? "#888")
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
