// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// The brand mark, in one place because it now appears in two: the sidebar rail
// and the floating ask-bar. Vendoring it twice would mean two copies of the
// licence note below, and they would drift.
//
// The menu-bar mascot, for continuity with the Mac app. Lucide's "brain"
// (https://lucide.dev), ISC licensed — vendored as one path set rather than
// pulling in the package, since this is the only icon needed from it and the
// engine artifact ships its dependencies.
//
//   Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
//   part of Feather (MIT). All other copyright (c) for Lucide are held by
//   Lucide Contributors 2022. ISC License.
//
// It replaces a hand-drawn approximation: the Mac icon uses Apple's SF Symbol
// "brain", whose artwork is licensed for Apple-platform apps and cannot be
// shipped in a web page. Lucide is the honest way to get the same mascot.
const BRAIN = (
  <>
    <path d="M12 18V5" />
    <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
    <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
    <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
    <path d="M18 18a4 4 0 0 0 2-7.464" />
    <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
    <path d="M6 18a4 4 0 0 1-2-7.464" />
    <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
  </>
);

/**
 * `size` is in px. The brain is eight paths in a 24-unit box: below ~18px its
 * folds close up and it reads as a smudge, so detailed sizes keep Lucide's
 * native stroke weight of 2 rather than being thinned to match smaller icons.
 *
 * The wrapper pulses (`blip`) — it is a liveness indicator, not decoration.
 */
export function JarvisMark({ size = 18 }: { size?: number }) {
  return (
    <span
      className="blip inline-flex items-center justify-center text-[var(--cyan)] [filter:drop-shadow(0_0_6px_var(--cyan-3))]"
      style={{ height: size, width: size }}
    >
      <svg viewBox="0 0 24 24" style={{ height: size, width: size }} fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {BRAIN}
      </svg>
    </span>
  );
}
