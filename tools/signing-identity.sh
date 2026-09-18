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

have_identity() { security find-identity -v -p codesigning 2>/dev/null | grep -q "$NAME"; }

status() {
  if have_identity; then
    printf "  identity present: %s\n" "$NAME"
    printf "  configured in:    %s\n" "$([ -s "$SETTING" ] && cat "$SETTING" || echo '(not written yet)')"
    for app in tools/menubar/JarvisBar.app tools/call-capture/JarvisAudio.app; do
      [ -d "$JARVIS_DIR/$app" ] || continue
      sig="$(codesign -dv "$JARVIS_DIR/$app" 2>&1 | grep -i '^Signature' | head -1)"
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
    openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -out "$tmp/id.p12" \
      -passout pass:jarvis -name "$NAME" >/dev/null 2>&1 \
      || { echo "  could not bundle the certificate" >&2; exit 1; }

    echo "  importing into your login keychain — macOS may ask for your password"
    # -T codesign lets codesign use the key without prompting on every build
    security import "$tmp/id.p12" -k ~/Library/Keychains/login.keychain-db \
      -P jarvis -T /usr/bin/codesign >/dev/null \
      || { echo "  keychain import failed" >&2; exit 1; }
    security add-trusted-cert -d -r trustAsRoot -p codeSign \
      -k ~/Library/Keychains/login.keychain-db "$tmp/cert.pem" >/dev/null 2>&1 \
      || echo "  note: could not mark it trusted automatically — open Keychain Access," \
              "find '$NAME', and set Code Signing to Always Trust"
    have_identity || { echo "  the identity did not appear — see Keychain Access" >&2; exit 1; }
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
