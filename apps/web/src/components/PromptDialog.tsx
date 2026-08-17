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
        className="w-[400px] rounded-2xl border border-[rgba(57,215,255,.35)] p-5 shadow-[0_0_50px_rgba(57,215,255,.18)]"
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
          className="w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-4 py-3 font-sans text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--dim)] focus:border-[var(--cyan)] focus:shadow-[0_0_16px_rgba(57,215,255,.15)]"
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
            className="rounded-lg border border-[rgba(57,215,255,.5)] bg-[rgba(57,215,255,.12)] px-4 py-2 text-[10px] tracking-wider text-[var(--cyan)] hover:bg-[rgba(57,215,255,.2)] disabled:opacity-40"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
