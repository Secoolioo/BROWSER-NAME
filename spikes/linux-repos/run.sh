#!/usr/bin/env bash
# Builds deb and rpm packages for 0.1.0-beta.1, 0.1.0-beta.2 and 0.1.0, publishes them in
# signed APT and DNF repositories on 127.0.0.1 and upgrades through them in containers.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
ROOT=$PWD
OUT="$ROOT/out"
WWW="$ROOT/www"
PORT=8080
BASE="http://127.0.0.1:$PORT"
mkdir -p "$OUT" "$WWW"
note() { echo "$*" | tee -a "$OUT/results.txt"; }
VERSIONS=(0.1.0-beta.1 0.1.0-beta.2 0.1.0)

npm install --no-audit --no-fund >/dev/null
for v in "${VERSIONS[@]}"; do
  npx electron-builder --linux deb rpm --publish never -c.extraMetadata.version="$v" \
    -c.directories.output="dist/$v" >"$OUT/build-$v.log" 2>&1 || { note "build $v failed"; tail -30 "$OUT/build-$v.log"; exit 1; }
  note "built $v: deb $(dpkg-deb -f dist/"$v"/*.deb Version) rpm $(rpm -qp --qf '%{VERSION}-%{RELEASE}' dist/"$v"/*.rpm 2>/dev/null)"
done

export GNUPGHOME="$ROOT/gnupg"
mkdir -p "$GNUPGHOME" && chmod 700 "$GNUPGHOME"
gpg --batch --passphrase '' --quick-generate-key "Repo Spike <repo-spike@example.invalid>" ed25519 sign never 2>/dev/null
KEYID=$(gpg --list-keys --with-colons | awk -F: '/^fpr/ { print $10; exit }')
gpg --armor --export "$KEYID" >"$WWW/key.asc"
gpg --export "$KEYID" >"$WWW/key.gpg"

# Release assets live in versioned directories, as on GitHub Releases.
for v in "${VERSIONS[@]}"; do
  mkdir -p "$WWW/releases/download/v$v"
  cp dist/"$v"/*.rpm "$WWW/releases/download/v$v/"
  cp dist/"$v"/*.deb "$WWW/releases/download/v$v/"
done
for f in "$WWW"/releases/download/*/*.rpm; do
  rpmsign --define "_gpg_name $KEYID" --addsign "$f" >"$OUT/rpmsign.log" 2>&1 || note "rpmsign failed for $f: $(tail -1 "$OUT/rpmsign.log")"
done

apt_repo() { # suite, versions...
  local suite=$1
  shift
  mkdir -p "$WWW/apt/pool/$suite" "$WWW/apt/dists/$suite/main/binary-amd64"
  rm -f "$WWW/apt/pool/$suite"/*
  for v in "$@"; do cp "$WWW/releases/download/v$v/"*.deb "$WWW/apt/pool/$suite/repo-spike_${v}_amd64.deb"; done
  (cd "$WWW/apt" && apt-ftparchive packages "pool/$suite" >"dists/$suite/main/binary-amd64/Packages" &&
    gzip -kf "dists/$suite/main/binary-amd64/Packages" &&
    apt-ftparchive -o APT::FTPArchive::Release::Suite="$suite" -o APT::FTPArchive::Release::Codename="$suite" \
      -o APT::FTPArchive::Release::Components=main -o APT::FTPArchive::Release::Architectures=amd64 \
      release "dists/$suite" >"dists/$suite/Release")
  gpg --batch --yes --clearsign -u "$KEYID" -o "$WWW/apt/dists/$suite/InRelease" "$WWW/apt/dists/$suite/Release"
}

rpm_repo() { # name, versions...
  local name=$1
  shift
  local stage="$ROOT/stage-$name"
  rm -rf "$stage" && mkdir -p "$stage"
  for v in "$@"; do mkdir -p "$stage/v$v" && cp "$WWW/releases/download/v$v/"*.rpm "$stage/v$v/"; done
  createrepo_c --quiet --baseurl "$BASE/releases/download/" "$stage"
  rm -rf "$WWW/rpm/$name" && mkdir -p "$WWW/rpm/$name"
  cp -r "$stage/repodata" "$WWW/rpm/$name/"
  gpg --batch --yes --detach-sign --armor -u "$KEYID" -o "$WWW/rpm/$name/repodata/repomd.xml.asc" "$WWW/rpm/$name/repodata/repomd.xml"
}

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$WWW" >"$OUT/http.log" 2>&1 &

apt_step() { # image, suite, expected version, label
  docker exec spike-apt bash -c "apt-get update -qq >/dev/null 2>&1; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq repo-spike >/dev/null 2>&1; dpkg-query -W -f='\${Version}' repo-spike" >"$OUT/v.txt" 2>&1
  local got
  got=$(cat "$OUT/v.txt")
  if [ "$got" = "$3" ]; then note "ok   $1 $2 $4: $got"; else note "FAIL $1 $2 $4: got '$got', want '$3'"; fi
}

for image in ubuntu:22.04 ubuntu:24.04 debian:12 debian:13; do
  docker rm -f spike-apt >/dev/null 2>&1
  docker run -d --name spike-apt --network host "$image" sleep 3600 >/dev/null
  docker exec spike-apt bash -c 'apt-get update -qq >/dev/null && apt-get install -y -qq ca-certificates >/dev/null'
  docker cp "$WWW/key.gpg" spike-apt:/usr/share/keyrings/repo-spike.gpg
  docker exec spike-apt bash -c "printf 'Types: deb\nURIs: $BASE/apt\nSuites: beta\nComponents: main\nSigned-By: /usr/share/keyrings/repo-spike.gpg\n' >/etc/apt/sources.list.d/repo-spike.sources"
  apt_repo beta 0.1.0-beta.1
  apt_step "$image" beta "0.1.0~beta.1" install
  apt_repo beta 0.1.0-beta.1 0.1.0-beta.2
  apt_step "$image" beta "0.1.0~beta.2" upgrade
  apt_repo beta 0.1.0-beta.2 0.1.0
  apt_step "$image" beta "0.1.0" upgrade-to-stable
  if docker exec spike-apt bash -c 'dpkg --compare-versions 0.1.0~beta.2 lt 0.1.0'; then
    note "ok   $image dpkg orders ~beta before final"
  else
    note "FAIL $image dpkg ordering"
  fi
  docker rm -f spike-apt >/dev/null
done

dnf_step() { # image, expected, label
  docker exec spike-dnf bash -c "dnf -q -y --refresh install repo-spike >/dev/null 2>&1 && dnf -q -y upgrade repo-spike >/dev/null 2>&1; rpm -q --qf '%{VERSION}' repo-spike" >"$OUT/v.txt" 2>&1
  local got
  got=$(cat "$OUT/v.txt")
  if [ "$got" = "$2" ]; then note "ok   $1 $3: $got"; else note "FAIL $1 $3: got '$got', want '$2'"; fi
}

docker pull -q fedora:latest >/dev/null
LATEST=$(docker run --rm fedora:latest bash -c '. /etc/os-release; echo $VERSION_ID')
for image in "fedora:$LATEST" "fedora:$((LATEST - 1))"; do
  docker rm -f spike-dnf >/dev/null 2>&1
  docker run -d --name spike-dnf --network host "$image" sleep 3600 >/dev/null
  docker exec spike-dnf bash -c "printf '[repo-spike-beta]\nname=Repo Spike beta\nbaseurl=$BASE/rpm/beta\nenabled=1\ngpgcheck=1\nrepo_gpgcheck=1\ngpgkey=$BASE/key.asc\n' >/etc/yum.repos.d/repo-spike-beta.repo"
  rpm_repo beta 0.1.0-beta.1
  dnf_step "$image" "0.1.0~beta.1" install
  rpm_repo beta 0.1.0-beta.1 0.1.0-beta.2
  dnf_step "$image" "0.1.0~beta.2" upgrade
  rpm_repo beta 0.1.0-beta.2 0.1.0
  dnf_step "$image" "0.1.0" upgrade-to-stable
  docker exec spike-dnf bash -c 'rpm --version; dnf --version | head -1' | tr '\n' ' ' | sed 's/^/tools: /' | tee -a "$OUT/results.txt"
  echo >>"$OUT/results.txt"
  docker rm -f spike-dnf >/dev/null
done
grep -q '^FAIL' "$OUT/results.txt" && exit 1
exit 0
