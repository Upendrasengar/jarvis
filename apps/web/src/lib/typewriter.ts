// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Typewriter reveal — the network stream arrives in big chunks (fast model,
// concise replies), so raw rendering looks like one-shot paste. This animates
// the reveal at ~120+ chars/sec, accelerating when the backlog grows so it
// never lags far behind the real stream — same trick claude.ai uses.
//
// The animation is POLISH, and must never be the only route text takes to the
// screen. It used to be: every render went through the requestAnimationFrame
// loop, and rAF does not fire in a hidden or heavily throttled tab. Send a
// message, switch away while it answers, come back — the reply had arrived,
// the session knew it, and the bubble sat on "…" forever, because the promise
// that ends the turn was also resolved from inside that same loop.
export function makeTypewriter(render: (t: string) => void) {
  let target = "";
  let shown = "";
  let stopped = false;
  let resolveDone: (() => void) | null = null;

  const hidden = () => typeof document !== "undefined" && document.hidden;

  // Give up animating and put everything on screen. Safe to call twice.
  const snap = () => {
    if (stopped) return;
    stopped = true;
    shown = target;
    render(shown);
    const done = resolveDone;
    resolveDone = null;
    done?.();
  };

  const tick = () => {
    if (stopped) return;
    if (hidden()) { snap(); return; }       // nothing to animate to
    if (!target.startsWith(shown)) {        // content replaced (e.g. error) — snap
      shown = target;
      render(shown);
    } else if (shown.length < target.length) {
      const backlog = target.length - shown.length;
      const step = Math.max(2, Math.ceil(backlog / 24));   // catch-up curve
      shown = target.slice(0, shown.length + step);
      render(shown);
    } else if (resolveDone) {
      stopped = true;
      const done = resolveDone;
      resolveDone = null;
      done();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // A tab hidden mid-reveal stops ticking; land the text rather than freeze.
  const onHide = () => { if (hidden() && resolveDone) snap(); };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onHide);
  const cleanup = () => {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onHide);
  };

  return {
    feed(t: string) { target = t; },
    // Stream ended: keep typing until everything is revealed, then resolve.
    // The final text is guaranteed on screen by every exit from here.
    finish(finalText: string): Promise<void> {
      target = finalText;
      if (stopped || shown === target || hidden()) {
        stopped = true;
        render(target);                     // even when already caught up
        cleanup();
        return Promise.resolve();
      }
      return new Promise((res) => {
        const done = () => { cleanup(); res(); };
        resolveDone = () => { render(target); done(); };
        // Backstop: if the loop is throttled to a crawl rather than stopped,
        // a finished reply still must not wait on it.
        setTimeout(() => { if (!stopped) { stopped = true; render(target); done(); } }, 4000);
      });
    },
    // hard stop (connection lost): show the message immediately
    abort(finalText: string) { stopped = true; cleanup(); render(finalText); },
  };
}
