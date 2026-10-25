#!/usr/bin/env bash
# Installs the browser from the live APT and DNF repositories, set up the way the download
# page describes it, and checks that each channel delivers its newest release.
#
# Usage: app/tests/linux-repos/live.sh <site url> <stable version> <beta version>
# An empty version skips that channel; the beta channel also receives stable releases.
set -euo pipefail

root="$(cd "$(dirname "$0")/../../.." && pwd)"
site="${1%/}/"
slug=$(node -p "require('$root/brand.json').slug")
product=$(node -p "require('$root/brand.json').productName")
failures=0

check() { # description, expected, actual
  if [ "$2" = "$3" ]; then
    echo "ok    $1: $3"
  else
    echo "FAIL  $1: expected '$2', got '$3'"
    failures=$((failures + 1))
  fi
}

for channel in stable beta; do
  if [ "$channel" = stable ]; then version="$2"; else version="$3"; fi
  [ -n "$version" ] || continue
  # Package versions sort prereleases with a tilde: 0.1.0-beta.1 is 0.1.0~beta.1.
  expected="${version/-/\~}"

  installed=$(docker run --rm ubuntu:24.04 bash -c "
    set -e
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq >/dev/null && apt-get install -y -qq curl ca-certificates >/dev/null
    curl -fsSL '${site}linux-repo.asc' -o '/usr/share/keyrings/$slug.asc'
    printf 'Types: deb\nURIs: %s\nSuites: %s\nComponents: main\nSigned-By: %s\n' \
      '${site}apt' '$channel' '/usr/share/keyrings/$slug.asc' >'/etc/apt/sources.list.d/$slug.sources'
    apt-get update -qq >/dev/null && apt-get install -y -qq '$slug' >/dev/null
    dpkg-query -W -f='\${Version}' '$slug'")
  check "APT $channel installs the newest release" "$expected" "$installed"

  installed=$(docker run --rm fedora:latest bash -c "
    set -e
    printf '[%s]\nname=%s\nbaseurl=%s\nenabled=1\ngpgcheck=1\nrepo_gpgcheck=1\ngpgkey=%s\n' \
      '$slug' '$product' '${site}rpm/$channel' '${site}linux-repo.asc' >'/etc/yum.repos.d/$slug.repo'
    dnf install -y -q '$slug' >/dev/null
    rpm -q --qf '%{VERSION}' '$slug'")
  check "DNF $channel installs the newest release" "$expected" "$installed"
done

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "The live package repositories deliver the newest releases"
