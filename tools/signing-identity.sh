#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# signing-identity.sh [create|status] — a stable code-signing identity for
# JarvisBar.app and JarvisAudio.app (plan Task 12).
#
# Why this exists: both bundles are signed ad-hoc (`codesign -s -`), which
# produces NO identity at all. macOS therefore binds their TCC grants to the
# exact binary hash, so every rebuild silently revokes Screen Recording and
# Microphone. That is not hypothetical — it cost two calls their system audio
# and eight calls the owner's own voice, each time looking like a code bug.
#
# A stable signing identity gives the apps a designated requirement that
# survives rebuilds. A Developer ID from Apple ($99/yr) is required to
# distribute to OTHER people without Gatekeeper warnings; for grants on your
# own machine a free self-signed certificate is enough, and that is what this
# creates.
set -euo pipefail

JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${JARVIS_SIGNING_NAME:-Jarvis Local Signing}"
SETTING="$JARVIS_DIR/memory/settings/signing-identity.txt"

# Deliberately NOT `find-identity -v`. The -v list is "valid" identities, and a
# self-signed certificate reads as CSSMERR_TP_NOT_TRUSTED until someone marks it
# trusted — which needs an admin password. But trust governs VERIFYING a
# signature, not producing one: codesign signs happily with an untrusted key,
# and the resulting bundle keeps a stable identity across rebuilds, which is the
# entire point here. Requiring -v made a working identity look like a failure.
have_identity() { security find-identity -p codesigning 2>/dev/null | grep -q "$NAME"; }

status() {
  if have_identity; then
    printf "  identity present: %s\n" "$NAME"
    printf "  configured in:    %s\n" "$([ -s "$SETTING" ] && cat "$SETTING" || echo '(not written yet)')"
    for app in tools/menubar/JarvisBar.app tools/call-capture/JarvisAudio.app; do
      [ -d "$JARVIS_DIR/$app" ] || continue
      # Authority names the identity; a real signature reports only
      # "Signature size=NNNN", which tells the owner nothing useful.
      sig="$(codesign -dvvv "$JARVIS_DIR/$app" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
      [ -n "$sig" ] || sig="$(codesign -dv "$JARVIS_DIR/$app" 2>&1 | sed -n 's/^Signature=//p' | head -1)"
      printf "  %-34s %s\n" "$(basename "$app")" "${sig:-unsigned}"
    done
  else
    printf "  no '%s' identity in the keychain — run: jarvis sign create\n" "$NAME"
    printf "  (ad-hoc signing means every rebuild revokes recording permissions)\n"
  fi
}

create() {
  if have_identity; then
    echo "  '$NAME' already exists — nothing to do"
  else
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' RETURN
    cat > "$tmp/ext.cnf" <<CNF
[ req ]
distinguished_name = dn
x509_extensions = v3
prompt = no
[ dn ]
CN = $NAME
[ v3 ]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF
    openssl req -x509 -newkey rsa:2048 -keyout "$tmp/key.pem" -out "$tmp/cert.pem" \
      -days 3650 -nodes -config "$tmp/ext.cnf" >/dev/null 2>&1 \
      || { echo "  could not generate a certificate" >&2; exit 1; }
    # macOS Security rejects the PKCS#12 MAC OpenSSL 3 writes by default
    # (sha256), failing with "MAC verification failed ... wrong password?" —
    # which is misleading, since the password is fine. Pin the legacy sha1 MAC
    # and 3DES so the keychain will accept the bundle.
    openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -out "$tmp/id.p12" \
      -passout pass:jarvis -name "$NAME" \
      -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 >/dev/null 2>&1 \
      || { echo "  could not bundle the certificate" >&2; exit 1; }

    echo "  importing into your login keychain — macOS may ask for your password"
    # -T codesign lets codesign use the key without prompting on every build
    security import "$tmp/id.p12" -k ~/Library/Keychains/login.keychain-db \
      -P jarvis -T /usr/bin/codesign >/dev/null \
      || { echo "  keychain import failed" >&2; exit 1; }
    # Optional, and it needs an admin password, so failure is not an error:
    # marking the certificate trusted only affects signature VERIFICATION.
    # Signing works either way.
    security add-trusted-cert -d -r trustAsRoot -p codeSign \
      -k ~/Library/Keychains/login.keychain-db "$tmp/cert.pem" >/dev/null 2>&1 \
      && echo "  marked trusted for code signing"
    have_identity || { echo "  the identity did not appear — see Keychain Access" >&2; exit 1; }
    # Prove it before claiming success. A certificate in the keychain whose
    # private key codesign cannot reach would pass every check above and then
    # fail at the only moment that matters.
    probe="$tmp/probe"; mkdir -p "$probe"; printf '#!/bin/sh\nexit 0\n' > "$probe/x"; chmod +x "$probe/x"
    codesign --force -s "$NAME" "$probe/x" >/dev/null 2>&1 \
      || { echo "  the identity exists but codesign cannot use it — see Keychain Access" >&2; exit 1; }
    echo "  identity created"
  fi

  mkdir -p "$(dirname "$SETTING")"
  echo "$NAME" > "$SETTING"
  echo "  recorded in memory/settings/signing-identity.txt — install.sh will use it"
  echo
  echo "  Re-sign now so the change takes effect:"
  echo "    jarvis setup"
  echo "  You will need to re-grant Screen Recording and Microphone to Jarvis Audio"
  echo "  ONE more time. After that, rebuilds keep the grant."
}

case "${1:-status}" in
  create) create ;;
  status) status ;;
  *) echo "usage: signing-identity.sh [create|status]" >&2; exit 1 ;;
esac
