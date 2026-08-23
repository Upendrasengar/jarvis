// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Styled replacement for window.prompt — JARVIS-themed modal with backdrop,
// Enter to submit, Escape to cancel.
import { useEffect, useRef, useState } from "react";

export function PromptDialog({
  open,
  title,
  placeholder,
  submitLabel = "CREATE",
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--bg)" }}
        className="w-[400px] rounded-2xl border border-[var(--cyan-3)] bg-[var(--surf)] p-5 [box-shadow:var(--shadow)]"
      >
        <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[1.5px] text-[var(--cyan)]">
          <span className="h-[7px] w-[7px] rounded-full bg-[var(--cyan)] shadow-[0_0_8px_var(--cyan)]" />
          {title}
        </div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
          placeholder={placeholder}
          className="w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-4 py-3 font-sans text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--dim)] focus:border-[var(--cyan-3)]"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--line)] px-4 py-2 text-[10px] tracking-wider text-[var(--dim)] hover:text-[var(--bright)]"
          >
            CANCEL
          </button>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="rounded-lg border border-[var(--cyan-3)] bg-[var(--cyan-2)] px-4 py-2 text-[10px] tracking-wider text-[var(--cyan)] hover:bg-[var(--cyan-3)] disabled:opacity-40"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
