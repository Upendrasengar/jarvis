// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// The arc-reactor core — the HUD-ring alternative to the particle sphere,
// visually kin to the favicon (the "J" ring). Pure strokes, so it renders
// crisply on both themes. Same living-status language as the particle core:
//   recording   → red outer arc pulses
//   processing  → amber sweep orbits the segment ring
//   agents      → one bright dot per working agent on the outer orbit
//   voice       → the core breathes with live amplitude
import { useEffect, useRef } from "react";
import type { CoreStatus } from "./ParticleCore";

const TAU = Math.PI * 2;

export function ArcReactorCore({ status, center = "glow" }: { status: CoreStatus; center?: "glow" | "eye" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const centerRef = useRef(center);
  centerRef.current = center;

  useEffect(() => {
    const canvas = ref.current!;
    const x = canvas.getContext("2d")!;
    let cx = 0, cy = 0, R = 0;
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      cx = canvas.width / 2; cy = canvas.height / 2;
      R = Math.min(cx, cy) * 0.74;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let t = 0, raf = 0;
    // eye state: random blinks + saccadic gaze drift
    let blinkStart = -999, nextBlink = 200 + Math.random() * 240;
    let gazeX = 0, gazeY = 0, targX = 0, targY = 0, nextSacc = 120;

    // photographic oculus — the user's generated eye, masked into a lens,
    // with breathing zoom, saccadic drift, shaded blinking lids, and a
    // periodic biometric scan sweep
    const eyeImg = new Image();
    eyeImg.src = "/oculus-eye.jpg";
    let scanStart = -999, nextScan = 300;

    const drawEye = (level: number, cyan: string, light: boolean) => {
      if (t > nextBlink) { blinkStart = t; nextBlink = t + 180 + Math.random() * 420; }
      const bp = (t - blinkStart) / 8;
      const open = bp < 1 ? 1 - bp : bp < 2 ? bp - 1 : 1;
      if (t > nextSacc) {
        targX = (Math.random() - 0.5) * 10;
        targY = (Math.random() - 0.5) * 6;
        nextSacc = t + 120 + Math.random() * 360;
      }
      gazeX += (targX - gazeX) * 0.06;
      gazeY += (targY - gazeY) * 0.06;

      const eyeR = R * 0.30;
      x.save();
      x.beginPath(); x.arc(cx, cy, eyeR, 0, TAU); x.clip();

      if (eyeImg.complete && eyeImg.naturalWidth) {
        // breathing zoom; leans in slightly while voice is active
        const zoom = 1.12 + 0.03 * Math.sin(t * 0.015) + level * 0.1;
        const drawH = eyeR * 2 * zoom;
        const drawW = drawH * (eyeImg.naturalWidth / eyeImg.naturalHeight);
        x.drawImage(eyeImg, cx - drawW / 2 + gazeX, cy - drawH / 2 + gazeY, drawW, drawH);
      } else {
        x.fillStyle = "#06121e";
        x.fillRect(cx - eyeR, cy - eyeR, eyeR * 2, eyeR * 2);
      }

      // blinking lids — shaded flaps closing over the lens
      const closure = 1 - open;
      if (closure > 0.02) {
        const lidTop = cy - eyeR + eyeR * 2 * closure * 0.62;
        const lidBot = cy + eyeR - eyeR * 2 * closure * 0.5;
        x.fillStyle = "#0b0d10";
        x.beginPath();
        x.moveTo(cx - eyeR, cy - eyeR);
        x.lineTo(cx + eyeR, cy - eyeR);
        x.lineTo(cx + eyeR, lidTop - eyeR * 0.12);
        x.quadraticCurveTo(cx, lidTop + eyeR * 0.16, cx - eyeR, lidTop - eyeR * 0.12);
        x.closePath(); x.fill();
        x.beginPath();
        x.moveTo(cx - eyeR, cy + eyeR);
        x.lineTo(cx + eyeR, cy + eyeR);
        x.lineTo(cx + eyeR, lidBot + eyeR * 0.1);
        x.quadraticCurveTo(cx, lidBot - eyeR * 0.14, cx - eyeR, lidBot + eyeR * 0.1);
        x.closePath(); x.fill();
      }

      // biometric scan sweep (always during processing, occasional otherwise)
      if (statusRef.current.processing || t < scanStart + 90) {
        const ph = statusRef.current.processing ? (t * 0.012) % 1 : (t - scanStart) / 90;
        const sx = cx - eyeR + ph * eyeR * 2;
        const sg = x.createLinearGradient(sx - 12, 0, sx + 12, 0);
        sg.addColorStop(0, `rgba(${cyan},0)`);
        sg.addColorStop(0.5, `rgba(${cyan},.4)`);
        sg.addColorStop(1, `rgba(${cyan},0)`);
        x.fillStyle = sg;
        x.fillRect(sx - 12, cy - eyeR, 24, eyeR * 2);
      }
      if (t > nextScan) { scanStart = t; nextScan = t + 500 + Math.random() * 500; }
      x.restore();

      // bright lens rim
      if (!light) { x.shadowColor = `rgba(${cyan},.8)`; x.shadowBlur = 14; }
      x.strokeStyle = `rgba(${cyan},${light ? 0.8 : 0.9})`;
      x.lineWidth = 2;
      x.beginPath(); x.arc(cx, cy, eyeR, 0, TAU); x.stroke();
      x.shadowBlur = 0;
      x.strokeStyle = `rgba(${cyan},.25)`;
      x.lineWidth = 6;
      x.beginPath(); x.arc(cx, cy, eyeR + 5, 0, TAU); x.stroke();
    };

    const loop = () => {
      t += 1;
      const light = document.documentElement.classList.contains("light");
      const st = statusRef.current;
      const level = Math.max(0, Math.min(1, ((window as any)._jarvisVoiceLevel as number) || 0));

      const cyan = light ? "3,105,161" : "57,215,255";
      const violet = light ? "76,29,149" : "120,90,255";
      const glow = (blur: number) => { if (!light) { x.shadowColor = `rgba(${cyan},.8)`; x.shadowBlur = blur; } };
      const noGlow = () => { x.shadowBlur = 0; };

      x.clearRect(0, 0, canvas.width, canvas.height);

      if (centerRef.current === "eye") {
        // halo behind the eye
        const hg = x.createRadialGradient(cx, cy, 0, cx, cy, R * 0.4);
        hg.addColorStop(0, `rgba(${cyan},${light ? 0.18 : 0.3})`);
        hg.addColorStop(1, `rgba(${cyan},0)`);
        x.fillStyle = hg;
        x.beginPath(); x.arc(cx, cy, R * 0.4, 0, TAU); x.fill();
        drawEye(level, cyan, light);
      } else {
        // breathing core
        const coreR = R * (0.16 + level * 0.05 + 0.008 * Math.sin(t * 0.05));
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.6);
        if (light) {
          g.addColorStop(0, "rgba(3,105,161,.55)");
          g.addColorStop(0.5, "rgba(3,105,161,.12)");
          g.addColorStop(1, "rgba(3,105,161,0)");
        } else {
          g.addColorStop(0, `rgba(230,250,255,${0.85 + level * 0.15})`);
          g.addColorStop(0.35, `rgba(${cyan},.55)`);
          g.addColorStop(1, `rgba(${cyan},0)`);
        }
        x.fillStyle = g;
        x.beginPath(); x.arc(cx, cy, coreR * 2.6, 0, TAU); x.fill();
        glow(18);
        x.fillStyle = light ? `rgba(${cyan},.9)` : "rgba(235,252,255,.95)";
        x.beginPath(); x.arc(cx, cy, coreR * 0.55, 0, TAU); x.fill();
        noGlow();
      }

      // inner solid ring
      glow(8);
      x.strokeStyle = `rgba(${cyan},${light ? 0.7 : 0.8})`;
      x.lineWidth = 1.5;
      x.beginPath(); x.arc(cx, cy, R * 0.32, 0, TAU); x.stroke();
      noGlow();

      // segmented ring (slow rotation, shimmer)
      const segs = 24;
      const segR = R * 0.52;
      const rot = t * 0.003;
      for (let i = 0; i < segs; i++) {
        const a0 = rot + (i / segs) * TAU;
        const a1 = a0 + (TAU / segs) * 0.62;
        const bright = (Math.sin(t * 0.03 + i * 1.3) + 1) / 2;
        x.strokeStyle = `rgba(${cyan},${0.25 + bright * (light ? 0.45 : 0.6)})`;
        x.lineWidth = 7;
        x.beginPath(); x.arc(cx, cy, segR, a0, a1); x.stroke();
      }

      // thin violet accent ring, counter-rotating dashes
      x.save();
      x.translate(cx, cy);
      x.rotate(-t * 0.004);
      x.setLineDash([2, 14]);
      x.strokeStyle = `rgba(${violet},${light ? 0.55 : 0.7})`;
      x.lineWidth = 2;
      x.beginPath(); x.arc(0, 0, R * 0.66, 0, TAU); x.stroke();
      x.restore();
      x.setLineDash([]);

      // tick ring
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * TAU;
        const long = i % 5 === 0;
        const r0 = R * 0.78, r1 = r0 + (long ? 10 : 5);
        x.strokeStyle = `rgba(${cyan},${long ? 0.7 : 0.3})`;
        x.lineWidth = long ? 1.6 : 1;
        x.beginPath();
        x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        x.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        x.stroke();
      }

      // outer boundary ring with the little node (favicon detail)
      x.strokeStyle = `rgba(${cyan},.5)`;
      x.lineWidth = 1.5;
      x.beginPath(); x.arc(cx, cy, R * 0.9, 0, TAU); x.stroke();
      const nodeA = t * 0.002;
      glow(10);
      x.fillStyle = `rgba(${cyan},.95)`;
      x.beginPath();
      x.arc(cx + Math.cos(nodeA) * R * 0.9, cy + Math.sin(nodeA) * R * 0.9, 3.5, 0, TAU);
      x.fill();
      noGlow();

      // status: amber processing sweep
      if (st.processing) {
        const sweep = t * 0.015;
        x.strokeStyle = light ? "rgba(154,107,0,.85)" : "rgba(255,207,92,.85)";
        x.lineWidth = 3;
        x.beginPath(); x.arc(cx, cy, R * 0.585, sweep, sweep + TAU * 0.22); x.stroke();
      }

      // status: red recording pulse on the outermost radius
      if (st.recording) {
        const pulse = 0.4 + 0.35 * Math.sin(t * 0.09);
        x.strokeStyle = `rgba(255,92,122,${pulse})`;
        x.lineWidth = 2.5;
        x.beginPath(); x.arc(cx, cy, R * 0.97, 0, TAU); x.stroke();
      }

      // status: agent sparks on the outer orbit
      for (let k = 0; k < st.agents; k++) {
        const a = t * 0.02 + (k * TAU) / Math.max(1, st.agents);
        x.fillStyle = light ? "rgba(154,107,0,.95)" : "rgba(255,207,92,.95)";
        x.beginPath();
        x.arc(cx + Math.cos(a) * R * 0.84, cy + Math.sin(a) * R * 0.84, 3, 0, TAU);
        x.fill();
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}
