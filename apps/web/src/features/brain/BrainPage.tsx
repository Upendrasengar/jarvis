// KRONOS second-brain graph — 3d-force-graph with Obsidian-style always-on
// labels; port of the legacy renderer including the slow camera orbit.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ForceGraph3D from "3d-force-graph";
import SpriteText from "three-spritetext";

const COLORS: Record<string, string> = { work: "#39d7ff", projects: "#3ee08a", ref: "#2a3a4a" };

export function BrainPage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState("loading…");
  const navigate = useNavigate();

  useEffect(() => {
    const wrap = wrapRef.current!;
    let graph: any = null;
    let orbiting = true;
    let cancelled = false;

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
        .backgroundColor("#04070f")
        .nodeColor((n: any) => COLORS[n.group] ?? "#888")
        .nodeRelSize(3)
        .nodeVal((n: any) => 0.6 + Math.min(n.deg ?? 0, 14) * 0.4)
        .nodeOpacity(0.9)
        .nodeThreeObjectExtend(true)
        .nodeThreeObject((n: any) => {
          const s = new SpriteText(n.id);
          s.color = COLORS[n.group] ?? "#cfe8ff";
          s.textHeight = 2.6 + Math.min(n.deg ?? 0, 16) * 0.4;
          s.fontWeight = "600";
          s.position.set(0, -(5 + Math.min(n.deg ?? 0, 14) * 0.6), 0);
          s.material.depthWrite = false;
          s.material.depthTest = false;
          s.renderOrder = 10;
          return s;
        })
        .linkColor(() => "rgba(57,215,255,0.22)")
        .linkOpacity(0.4)
        .linkDirectionalParticles(1)
        .linkDirectionalParticleWidth(1.4)
        .linkDirectionalParticleColor(() => "#39d7ff")
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
      graph?._destructor?.();
      wrap.innerHTML = "";
    };
  }, []);

  return (
    <div className="relative h-full">
      <div className="absolute left-5 top-4 z-[5]">
        <div className="font-bold tracking-[2px] text-[var(--cyan)] [text-shadow:0_0_14px_rgba(57,215,255,.5)]">
          KRONOS · SECOND BRAIN
        </div>
        <div className="text-[11px] text-[var(--dim)]">{stats}</div>
      </div>
      <div ref={wrapRef} className="h-full" />
    </div>
  );
}
