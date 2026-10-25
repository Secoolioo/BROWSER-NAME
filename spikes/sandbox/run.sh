#!/usr/bin/env bash
# Runs on an Ubuntu host runner with unprivileged user namespaces restricted by AppArmor.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
OUT="$PWD/out"
mkdir -p "$OUT"
note() { echo "$*" | tee -a "$OUT/results.txt"; }

sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1 >/dev/null
note "restrict_unprivileged_userns=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)"
if unshare --user --map-root-user true 2>/dev/null; then note "unshare: ok"; else note "unshare: blocked"; fi

npm install --no-audit --no-fund >/dev/null
# fpm expands NAME, VERSION and ARCH in output paths, so build outside the checkout.
DIST="${RUNNER_TEMP:-/tmp}/sandbox-spike-dist"
npx electron-builder --publish never -c.directories.output="$DIST" >"$OUT/build.log" 2>&1 || { note "build failed"; tail -20 "$OUT/build.log"; exit 1; }
APPIMAGE_FILE=$(echo "$DIST"/*.AppImage)
DEB_FILE=$(echo "$DIST"/*.deb)
chmod +x "$APPIMAGE_FILE"

run() {
  local label=$1
  shift
  rm -f "$OUT/sandbox.json"
  SPIKE_OUT="$OUT/sandbox.json" timeout 60 "$@" >"$OUT/$label.log" 2>&1
  local code=$?
  if [ -f "$OUT/sandbox.json" ]; then
    note "$label: exit $code $(cat "$OUT/sandbox.json")"
  else
    note "$label: exit $code no result; $(grep -m2 -iE 'sandbox|fatal' "$OUT/$label.log" | cut -c1-200 | tr '\n' ' ')"
  fi
}

run appimage-default "$APPIMAGE_FILE"

PROFILE=/etc/apparmor.d/sandbox-spike-appimage
sudo tee "$PROFILE" >/dev/null <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile sandbox-spike-appimage /tmp/.mount_*/sandbox-spike flags=(unconfined) {
  userns,
  include if exists <local/sandbox-spike-appimage>
}
PROFILE
if sudo apparmor_parser -r "$PROFILE"; then note "appimage profile: loaded"; else note "appimage profile: failed"; fi
run appimage-with-profile "$APPIMAGE_FILE"
sudo apparmor_parser -R "$PROFILE" && sudo rm -f "$PROFILE"

run appimage-no-sandbox "$APPIMAGE_FILE" --no-sandbox

if sudo apt-get install -y "$DEB_FILE" 2>&1 | tee "$OUT/deb-install.log" >/dev/null; then note "deb: installed"; else note "deb: install failed"; fi
note "deb apparmor profiles: $(find /etc/apparmor.d -maxdepth 1 -iname '*spike*' -printf '%f ' 2>/dev/null)"
run deb-default /opt/SandboxSpike/sandbox-spike
sudo chmod 0755 /opt/SandboxSpike/chrome-sandbox
for p in /etc/apparmor.d/*pike*; do [ -f "$p" ] && sudo apparmor_parser -R "$p"; done
run deb-without-profile-or-suid /opt/SandboxSpike/sandbox-spike
sudo chmod 4755 /opt/SandboxSpike/chrome-sandbox
run deb-suid-only /opt/SandboxSpike/sandbox-spike
