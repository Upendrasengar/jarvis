#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# pre-push-audit.sh — blocks a push if outgoing commits contain secrets,
# user-data paths, or private identifiers. Install as a git hook:
#   ln -sf ../../tools/pre-push-audit.sh .git/hooks/pre-push
# Reads refs from stdin as git provides them; with no stdin (manual run)
# audits HEAD's full tree + history not on any remote.
#
# Personal identifiers (emails, employer/client names) belong in the
# GITIGNORED file secrets/audit-patterns.txt — one regex per line — so the
# public script never reveals what it protects.
set -uo pipefail
REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"

# generic secret patterns (values, not variable names)
SECRETS='sk-ant-[A-Za-z0-9]|sk-[A-Za-z0-9]{28,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[bpars]-[0-9A-Za-z-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY|eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|sig=[A-Za-z0-9_-]{30,}|api[_-]?key["'\''=: ]+[A-F0-9-]{30,}'
# paths that must never ship (user data)
# anchored to repo ROOT — apps/web/src/features/brain/ is source code, not data
BADPATHS='^(secrets|memory|reports|brain|data)/|\.env$|\.pem$|\.key$|(^|/)call-notes-|(^|/)digest-20|^reports/calls/'
ALLOW_PATHS='^memory\.example/'
# allowed author/committer emails (noreply only, extend via audit-patterns file with lines like ALLOW_EMAIL:regex)
ALLOW_EMAIL='users\.noreply\.github\.com$'

EXTRA=""
# patterns file: repo-local, or AUDIT_PATTERNS env (lets sibling repos share one)
JHOME_PATTERNS="${AUDIT_PATTERNS:-$REPO/secrets/audit-patterns.txt}"
[ -f "$JHOME_PATTERNS" ] && EXTRA="$(grep -v '^\s*#' "$JHOME_PATTERNS" | grep -v '^ALLOW_EMAIL:' | grep -v '^\s*$' | paste -sd '|' -)"
EXTRA_ALLOW="$(grep '^ALLOW_EMAIL:' "$JHOME_PATTERNS" 2>/dev/null | sed 's/^ALLOW_EMAIL://' | paste -sd '|' -)"
[ -n "$EXTRA_ALLOW" ] && ALLOW_EMAIL="$ALLOW_EMAIL|$EXTRA_ALLOW"

fail=0
say() { echo "pre-push-audit: $*" >&2; }

audit_range() {
  local range="$1"
  # 1) files introduced anywhere in the outgoing commits
  local files
  files="$(git log --name-only --format= "$range" 2>/dev/null | sort -u)"
  local badf
  badf="$(printf '%s\n' "$files" | grep -E "$BADPATHS" | grep -vE "$ALLOW_PATHS" || true)"
  if [ -n "$badf" ]; then say "BLOCKED — user-data paths in outgoing commits:"; printf '   %s\n' $badf >&2; fail=1; fi
  # 2) secret values / private identifiers in outgoing content
  local pat="$SECRETS"; [ -n "$EXTRA" ] && pat="$pat|$EXTRA"
  local hits
  hits="$(git log -p --format= "$range" 2>/dev/null | grep -iEn "^\+.*($pat)" | head -5 || true)"
  if [ -n "$hits" ]; then say "BLOCKED — secret-like or private strings in outgoing diffs:"; printf '%s\n' "$hits" | cut -c1-120 >&2; fail=1; fi
  # 3) author/committer emails
  local emails
  emails="$(git log --format='%ae%n%ce' "$range" 2>/dev/null | sort -u | grep -vE "$ALLOW_EMAIL" || true)"
  if [ -n "$emails" ]; then say "BLOCKED — non-noreply email in outgoing commits: $emails"; fail=1; fi
}

got_refs=0
if [ ! -t 0 ]; then
  while read -r _local_ref local_sha _remote_ref remote_sha; do
    got_refs=1
    [ -z "${local_sha:-}" ] && continue
    [ "$local_sha" = "0000000000000000000000000000000000000000" ] && continue
    if [ "${remote_sha:-}" = "0000000000000000000000000000000000000000" ] || [ -z "${remote_sha:-}" ]; then
      audit_range "$local_sha"
    else
      audit_range "$remote_sha..$local_sha"
    fi
  done
fi
# manual invocation (or empty stdin): audit the whole current history
[ "$got_refs" = 0 ] && audit_range "HEAD"

if [ "$fail" = 1 ]; then
  say "push rejected. Fix the findings (or, for a false positive, adjust secrets/audit-patterns.txt) and retry."
  exit 1
fi
exit 0
