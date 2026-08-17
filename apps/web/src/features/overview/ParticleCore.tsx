
// The particle neural core — now a LIVING status body, not decoration:
//   recording   → red ring pulses around the sphere
//   processing  → amber shimmer band sweeps through the particles
//   agents      → one orbiting spark per working agent
//   voice       → sphere breathes with live mic/TTS amplitude
//     (HeaderVoice publishes window._jarvisVoiceLevel each frame)
// Theme-aware: dark = additive glow (original look); light = crisp ink dots,
// no glow — the additive blend that turned into a washed-out blob is gone.
import { useEffect, useRef } from "react";

const PAL_DARK: [number, number, number][] = [
  [57, 215, 255], [120, 90, 255], [255, 60, 150], [80, 180, 255], [180, 120, 255],
];
const PAL_LIGHT: [number, number, number][] = [
  [3, 105, 161], [76, 29, 149], [190, 24, 93], [30, 64, 175], [109, 40, 217],
];

export type CoreStatus = { recording: boolean; processing: boolean; agents: number };

export function ParticleCore({ status }: { status: CoreStatus }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const canvas = ref.current!;
    const x = canvas.getContext("2d")!;
    let cx = 0, cy = 0, R = 0;
    const N = 1100;
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      cx = canvas.width / 2; cy = canvas.height / 2;
      R = Math.min(cx, cy) * 0.62;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const pts = Array.from({ length: N }, (_, i) => {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / N);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      return {
        x: Math.sin(phi) * Math.cos(theta),
        y: Math.sin(phi) * Math.sin(theta),
        z: Math.cos(phi),
        c: i % 5,
        sp: 0.4 + Math.random() * 0.9,
        ph: Math.random() * 6.28,
      };
    });

    let a = 0, t = 0, raf = 0;
    const loop = () => {
      t += 1;
      const light = document.documentElement.classList.contains("light");
      const st = statusRef.current;
      const level = Math.max(0, Math.min(1, ((window as any)._jarvisVoiceLevel as number) || 0));
      const energy = level * 0.9;
      a += 0.006 + energy * 0.01;

      x.clearRect(0, 0, canvas.width, canvas.height);
      x.globalCompositeOperation = light ? "source-over" : "lighter";
      const rr = R * (1 + 0.03 * Math.sin(t * 0.05) + energy * 0.18);

      if (!light) {
        const core = x.createRadialGradient(cx, cy, 0, cx, cy, rr * 1.3);
        core.addColorStop(0, `rgba(230,250,255,${0.5 + energy * 0.4})`);
        core.addColorStop(0.25, `rgba(57,215,255,${0.32 + energy * 0.4})`);
        core.addColorStop(0.6, `rgba(120,90,255,${0.12 + energy * 0.25})`);
        core.addColorStop(1, "rgba(57,215,255,0)");
        x.fillStyle = core;
        x.beginPath(); x.arc(cx, cy, rr * 1.3, 0, 7); x.fill();
      }

      const pal = light ? PAL_LIGHT : PAL_DARK;
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const rx = p.x * ca - p.z * sa, rz = p.x * sa + p.z * ca;
        const depth = (rz + 1) / 2;
        const surge = 1 + energy * 0.4 * (0.5 + 0.5 * Math.sin(t * 0.08 * p.sp + p.ph));
        const px = cx + rx * rr * surge, py = cy + p.y * rr * surge;
        // amber shimmer band while transcribing
        const shimmer = st.processing && ((i * 0.618 + t * 0.004) % 1) < 0.07;
        const [r, g, b] = shimmer ? [255, 207, 92] : pal[p.c];
        const al = light
          ? 0.25 + depth * 0.55
          : (0.12 + depth * 0.7) * (0.6 + energy * 0.4);
        x.fillStyle = `rgba(${r},${g},${b},${al})`;
        x.beginPath();
        x.arc(px, py, (light ? 0.8 : 0.5) + depth * (1.3 + energy * 1.2), 0, 7);
        x.fill();
      }

      x.globalCompositeOperation = "source-over";

      // red pulse ring while a call records
      if (st.recording) {
        const pulse = 0.45 + 0.35 * Math.sin(t * 0.09);
        x.strokeStyle = `rgba(255,92,122,${pulse})`;
        x.lineWidth = 2;
        x.beginPath(); x.arc(cx, cy, rr * 1.12, 0, 7); x.stroke();
        x.strokeStyle = `rgba(255,92,122,${pulse * 0.35})`;
        x.lineWidth = 5;
        x.beginPath(); x.arc(cx, cy, rr * 1.12, 0, 7); x.stroke();
      }

      // one orbiting spark per working agent
      for (let k = 0; k < st.agents; k++) {
        const ang = t * 0.02 + (k * Math.PI * 2) / Math.max(1, st.agents);
        const sx = cx + Math.cos(ang) * rr * 1.2;
        const sy = cy + Math.sin(ang) * rr * 1.2 * 0.45;
        x.fillStyle = light ? "rgba(154,107,0,.95)" : "rgba(255,207,92,.95)";
        x.beginPath(); x.arc(sx, sy, 3, 0, 7); x.fill();
        x.fillStyle = light ? "rgba(154,107,0,.25)" : "rgba(255,207,92,.3)";
        x.beginPath(); x.arc(sx, sy, 7, 0, 7); x.fill();
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}
