// Typewriter reveal — the network stream arrives in big chunks (fast model,
// concise replies), so raw rendering looks like one-shot paste. This animates
// the reveal at ~120+ chars/sec, accelerating when the backlog grows so it
// never lags far behind the real stream — same trick claude.ai uses.
export function makeTypewriter(render: (t: string) => void) {
  let target = "";
  let shown = "";
  let stopped = false;
  let resolveDone: (() => void) | null = null;

  const tick = () => {
    if (stopped) return;
    if (!target.startsWith(shown)) {      // content replaced (e.g. error) — snap
      shown = target;
      render(shown);
    } else if (shown.length < target.length) {
      const backlog = target.length - shown.length;
      const step = Math.max(2, Math.ceil(backlog / 24));   // catch-up curve
      shown = target.slice(0, shown.length + step);
      render(shown);
    } else if (resolveDone) {
      stopped = true;
      resolveDone();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return {
    feed(t: string) { target = t; },
    // stream ended: keep typing until everything is revealed, then resolve
    finish(finalText: string): Promise<void> {
      target = finalText;
      if (shown === target) { stopped = true; return Promise.resolve(); }
      return new Promise((res) => { resolveDone = () => { render(target); res(); }; });
    },
    // hard stop (connection lost): show the message immediately
    abort(finalText: string) { stopped = true; render(finalText); },
  };
}
