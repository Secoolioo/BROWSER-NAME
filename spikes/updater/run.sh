#!/usr/bin/env bash
# Builds versions 0.0.1 and 0.0.2, serves a signed feed on 127.0.0.1 and checks that the
# installed 0.0.1 rejects bad feeds and then updates itself silently to 0.0.2.
set -euo pipefail
cd "$(dirname "$0")"

PORT=8765
FEED="http://127.0.0.1:$PORT/"
case "$(uname -s)" in
  MINGW* | MSYS*) PLAT=win32 FORMAT=nsis DATA="$APPDATA/UpdateSpike" ;;
  Darwin) PLAT=darwin FORMAT=zip DATA="$HOME/Library/Application Support/UpdateSpike" ;;
  *) PLAT=linux FORMAT=appimage DATA="$HOME/.config/UpdateSpike" ;;
esac
ARCH=$(node -p process.arch)
OUT="$PWD/out"
mkdir -p "$OUT"
BUILDER_ARGS=()

if [ "$PLAT" = darwin ]; then
  # Self-signed code signing identity, as planned while no Developer ID exists.
  # A dedicated config avoids default CA extensions that LibreSSL would add twice.
  cat >cs.cnf <<'CNF'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = Update Spike Signing
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
CNF
  openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes -config cs.cnf -keyout cs.key -out cs.crt
  openssl x509 -in cs.crt -noout -text | grep -A1 -E 'X509v3' | tee "$OUT/cert.txt"
  openssl pkcs12 -export -inkey cs.key -in cs.crt -out cs.p12 -passout pass:spike \
    -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1
  # Code signing identities must be trusted to be valid; electron-builder imports the p12
  # into its own temporary keychain from CSC_LINK.
  sudo security add-trusted-cert -d -r trustRoot -p codeSign -k /Library/Keychains/System.keychain cs.crt
  export CSC_LINK="$PWD/cs.p12" CSC_KEY_PASSWORD=spike
  BUILDER_ARGS=(-c.mac.identity="Update Spike Signing")
fi

npm install --no-audit --no-fund
node tools.mjs keys keys

build() {
  printf '{"build":"%s"}\n' "$1" >variant.json
  local t0=$SECONDS
  npx electron-builder --publish never -c.extraMetadata.version="$1" "${BUILDER_ARGS[@]}"
  echo "build $1 took $((SECONDS - t0)) s" | tee -a "$OUT/timings.txt"
}
build 0.0.1
build 0.0.2
find dist/0.0.1 dist/0.0.2 -maxdepth 1 -type f -exec ls -l {} + | tee "$OUT/dist.txt"

feed() {
  rm -rf feed/updates
  node tools.mjs feed --dist "dist/$1" --out feed --key feed-private.pem --version "$1" \
    --sequence "$2" --platform "$PLAT" --arch "$ARCH" --format "$FORMAT" "${@:3}" >/dev/null
}
feed 0.0.1 1
node tools.mjs serve feed "$PORT" "$OUT/server.log" &

case "$PLAT" in
  win32)
    installer=(dist/0.0.1/update-spike-windows-*-setup.exe)
    MSYS_NO_PATHCONV=1 "${installer[0]}" /S
    find "$LOCALAPPDATA/Programs" -maxdepth 2 | tee -a "$OUT/install.txt"
    find "$LOCALAPPDATA" -maxdepth 2 -iname '*updater*' | tee -a "$OUT/install.txt"
    APP=
    for _ in $(seq 1 60); do
      APP=$(find "$LOCALAPPDATA/Programs" -maxdepth 2 -name UpdateSpike.exe | head -1)
      [ -n "$APP" ] && break
      sleep 1
    done
    echo "installed at $APP" | tee -a "$OUT/results.txt"
    ;;
  darwin)
    mkdir -p "$HOME/Applications"
    ditto -x -k dist/0.0.1/update-spike-macos-*.zip "$HOME/Applications"
    codesign -dv --verbose=2 "$HOME/Applications/UpdateSpike.app" 2>&1 | tee -a "$OUT/install.txt"
    codesign -d -r- "$HOME/Applications/UpdateSpike.app" 2>&1 | tee -a "$OUT/install.txt"
    APP="$HOME/Applications/UpdateSpike.app/Contents/MacOS/UpdateSpike"
    ;;
  linux)
    mkdir -p "$HOME/apps"
    cp dist/0.0.1/*.AppImage "$HOME/apps/update-spike.AppImage"
    chmod +x "$HOME/apps/update-spike.AppImage"
    APP="$HOME/apps/update-spike.AppImage"
    ;;
esac

expect() {
  local want=$1
  shift
  if "$APP" --check-update="$FEED" --expect="$want" "$@"; then
    echo "ok: $want" | tee -a "$OUT/results.txt"
  else
    echo "FAILED: $want" | tee -a "$OUT/results.txt"
    return 1
  fi
}

"$APP"
expect no-update
feed 0.0.1 5
expect no-update
feed 0.0.2 6 --tamper
expect ERR_FEED_SIGNATURE
feed 0.0.2 6 --expires-days -1
expect ERR_FEED_EXPIRED
feed 0.0.2 3
expect ERR_FEED_ROLLBACK
feed 0.0.2 7
t0=$SECONDS
"$APP" --check-update="$FEED" --expect=install &
for _ in $(seq 1 180); do
  if node -e "const r=require(process.argv[1]);process.exit(r.some(x=>x.mode==='start'&&x.version==='0.0.2')?0:1)" "$DATA/spike-state.json" 2>/dev/null; then
    echo "ok: updated to 0.0.2 in $((SECONDS - t0)) s" | tee -a "$OUT/results.txt"
    break
  fi
  sleep 1
done
cp "$DATA/spike-state.json" "$DATA/spike.log" "$OUT/" || true
grep -E 'download/v0.0.2/.*(exe|AppImage|zip) ' "$OUT/server.log" |
  awk '{ s += $4 } END { print "bytes downloaded for the update: " s }' | tee -a "$OUT/results.txt"
grep -q 'updated to 0.0.2' "$OUT/results.txt"
