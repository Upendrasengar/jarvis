#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# Where the Node runtime and tsx actually are. Sourced, never executed.
#
# These were resolved independently in services.sh and service.sh, and drifted:
# services.sh learned that a published artifact keeps tsx at the root while a
# pnpm checkout keeps it under apps/server, and service.sh did not. So
# `jarvis service install` reported "tsx not found — run: jarvis setup" on
# precisely the installs that had tsx, and told the owner to re-run the command
# that had just succeeded.
#
# One definition, two callers. The caller sets JARVIS_DIR first.

# JARVIS_NODE wins (the launcher sets it), then the runtime the engine ships
# with, then a pinned path, then PATH. An ABI match is not a preference — it is
# the difference between starting and a dlopen failure — so a bundled runtime
# outranks whatever `node` happens to be first on PATH.
jarvis_node() {
  [ -n "${JARVIS_NODE:-}" ] && { printf '%s' "$JARVIS_NODE"; return 0; }
  [ -x "$JARVIS_DIR/runtime/node" ] && { printf '%s' "$JARVIS_DIR/runtime/node"; return 0; }
  local pinned
  pinned="$(head -1 "$JARVIS_DIR/memory/settings/node-bin.txt" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$pinned" ] && [ -x "$pinned" ] && { printf '%s' "$pinned"; return 0; }
  command -v node 2>/dev/null
}

# A pnpm workspace symlinks tsx into apps/server; the published artifact
# installs production dependencies flat with npm, so it exists only at the
# root. Both layouts are normal — look in both.
jarvis_tsx() {
  local t="$JARVIS_DIR/apps/server/node_modules/tsx/dist/cli.mjs"
  [ -f "$t" ] || t="$JARVIS_DIR/node_modules/tsx/dist/cli.mjs"
  [ -f "$t" ] || return 1
  printf '%s' "$t"
}
