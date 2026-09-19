// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Comment entry anchored to the row it belongs to. The centered modal this
// replaces hid the item you were commenting on behind a blurred backdrop —
// exactly the context you need while writing. Multi-line by design: comments
// carry resolutions and references, not single words.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const W = 360;
const EDGE = 12;   // keep clear of the viewport edges
const GAP = 8;     // breathing room from the anchor

export function CommentPopover({
  anchor,
  title = "Add comment",
  placeholder = "Context, resolution, reference…",
  onSubmit,
  onClose,
}: {
  anchor: DOMRect;
  title?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Measure before paint so the box never flashes in the wrong place, and
  // flip above the anchor when there isn't room below it.
  useLayoutEffect(() => {
    const h = boxRef.current?.offsetHeight ?? 180;
    const left = Math.max(EDGE, Math.min(anchor.right - W, window.innerWidth - W - EDGE));
    const below = anchor.bottom + GAP;
    const want = below + h > window.innerHeight - EDGE ? anchor.top - GAP - h : below;
    // Clamp last, unconditionally: flipping above still overflows when the
    // anchor itself sits below the fold, and the box must always be reachable.
    const top = Math.max(EDGE, Math.min(want, window.innerHeight - EDGE - h));
    setPos({ top, left });
  }, [anchor]);

  // preventScroll matters: focusing inside a scroll container normally scrolls
  // it to reveal the field, which would trip the close-on-scroll below and
  // dismiss the box the instant it opened.
  useEffect(() => { taRef.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);

    // Any scroll or resize detaches the box from the row it points at, so it
    // closes — but only once the browser has settled after opening, so the
    // opening gesture can't dismiss it.
    const bail = () => onClose();
    const armed = requestAnimationFrame(() => {
      window.addEventListener("scroll", bail, true);
      window.addEventListener("resize", bail);
    });

    return () => {
      cancelAnimationFrame(armed);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", bail, true);
      window.removeEventListener("resize", bail);
    };
  }, [onClose]);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
    onClose();
  };

  return (
    <>
      {/* click-away catcher — transparent, so the ledger stays readable */}
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div
        ref={boxRef}
        style={{ width: W, top: pos?.top ?? 0, left: pos?.left ?? 0 }}
        className={`fixed z-50 rounded-xl border border-[var(--cyan-3)] bg-[var(--surf)] p-3 [box-shadow:var(--shadow-pop)] ${
          pos ? "" : "opacity-0"}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2 text-[9.5px] uppercase tracking-[1.5px] text-[var(--cyan)]">
          <span className="h-[6px] w-[6px] rounded-full bg-[var(--cyan)] shadow-[0_0_8px_var(--cyan)]" />
          {title}
        </div>
        <textarea
          ref={taRef}
          rows={3}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
          }}
          placeholder={placeholder}
          className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 font-sans text-[12.5px] leading-snug text-[var(--text)] outline-none placeholder:text-[var(--dim)] focus:border-[var(--cyan-3)]"
        />
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[9.5px] tracking-[1px] text-[var(--dim)]">⌘↵ to add · esc to cancel</span>
          <span className="flex-1" />
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--line)] px-3 py-[6px] text-[9.5px] tracking-wider text-[var(--dim)] hover:text-[var(--bright)]"
          >
            CANCEL
          </button>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="rounded-lg border border-[var(--cyan-3)] bg-[var(--cyan-2)] px-3 py-[6px] text-[9.5px] tracking-wider text-[var(--cyan)] hover:bg-[var(--cyan-3)] disabled:opacity-40"
          >
            ADD
          </button>
        </div>
      </div>
    </>
  );
}
