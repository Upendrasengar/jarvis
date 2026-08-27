// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// The @-mention dropdown. Pure presentation: ChatPage owns the open/index
// state, because the input's Enter and Escape keys have to be intercepted
// there before they reach submit.
import { useEffect, useRef } from "react";
import type { Mention } from "./useMentions";

export function MentionMenu({ items, index, onPick }: {
  items: Mention[];
  index: number;
  onPick: (m: Mention) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  // keep the keyboard selection in view when arrowing past the fold
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }); }, [index]);

  if (!items.length) return null;
  return (
    <div
      role="listbox"
      aria-label="Reference a note or call"
      className="absolute bottom-[calc(100%+8px)] left-0 z-20 max-h-[280px] w-[420px] max-w-[90vw] overflow-auto rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-1 [box-shadow:var(--shadow)]"
    >
      {items.map((m, i) => (
        <button
          key={`${m.kind}:${m.id}`}
          ref={i === index ? activeRef : undefined}
          role="option"
          aria-selected={i === index}
          // mousedown, not click: click fires after the input blurs, which
          // closes the menu and cancels the pick
          onMouseDown={(e) => { e.preventDefault(); onPick(m); }}
          className={`flex w-full items-baseline gap-2 rounded-xl px-3 py-2 text-left ${
            i === index ? "bg-[var(--cyan-2)]" : "hover:bg-[var(--surf-2)]"
          }`}
        >
          <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] text-[var(--text)]">
            {m.title}
          </span>
          <span className="shrink-0 font-mono text-[9.5px] tracking-[1px] text-[var(--dim)]">
            {m.sub}
          </span>
        </button>
      ))}
    </div>
  );
}
