#!/usr/bin/env bash
# Installs the deb and rpm packages of three releases on several distributions and updates
# them through the signed APT and DNF repositories: beta.1 is installed from its file, which
# registers the beta repository; the system then upgrades to beta.2 and to the stable
# release. Removing the package must remove the repository again.
#
# Usage: app/tests/linux-repos/run.sh <work dir> <beta.1 dir> <beta.2 dir> <stable dir>
# The package folders hold the x64 deb and rpm files. GNUPGHOME holds the repository key.
set -euo pipefail

root="$(cd "$(dirname "$0")/../../.." && pwd)"
work="$1"
dirs=("$2" "$3" "$4")
versions=(0.0.1-beta.1 0.0.1-beta.2 0.0.1)
channels=(beta beta stable)
slug=$(node -p "require('$root/brand.json').slug")
env_prefix=$(printf '%s' "$slug" | tr 'a-z-' 'A-Z_')
port=8137
base="http://127.0.0.1:$port"
site="$work/site"
failures=0

check() { # description, expected, actual
  if [ "$2" = "$3" ]; then
    echo "ok    $1: $3"
  else
    echo "FAIL  $1: expected '$2', got '$3'"
    failures=$((failures + 1))
  fi
}

# Publishes the given releases (indexes into the arrays above) in the site folder.
publish() {
  local specs=()
  for i in "$@"; do
    specs+=("${versions[$i]}:${channels[$i]}:${dirs[$i]}")
    mkdir -p "$site/download/v${versions[$i]}"
    cp "${dirs[$i]}"/*.rpm "$site/download/v${versions[$i]}/"
  done
  node "$root/tools/linux-repo/repo.ts" build --site "$site" --download-base "$base/download/" "${specs[@]}" >/dev/null
}

mkdir -p "$site"
for dir in "${dirs[@]}"; do node "$root/tools/linux-repo/repo.ts" sign-rpms "$dir" >/dev/null; done
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$site" >"$work/http.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true; docker rm -f repo-test >/dev/null 2>&1 || true' EXIT

for image in ubuntu:22.04 ubuntu:24.04 debian:12 debian:13; do
  docker rm -f repo-test >/dev/null 2>&1 || true
  docker run -d --name repo-test --network host -v "$work:$work:ro" -v "${dirs[0]}:/packages:ro" "$image" sleep 3600 >/dev/null
  in() { docker exec -e DEBIAN_FRONTEND=noninteractive repo-test bash -c "$1"; }
  publish 0
  in "apt-get update -qq >/dev/null && ${env_prefix}_REPO_URL=$base apt-get install -y -qq /packages/*.deb >/dev/null"
  check "$image installs beta.1 from its file" "0.0.1~beta.1" "$(in "dpkg-query -W -f='\${Version}' $slug")"
  check "$image registers the beta repository" "Suites: beta" "$(in "grep Suites /etc/apt/sources.list.d/$slug.sources")"
  publish 0 1
  in "apt-get update -qq >/dev/null && apt-get install -y -qq --only-upgrade $slug >/dev/null"
  check "$image upgrades to beta.2" "0.0.1~beta.2" "$(in "dpkg-query -W -f='\${Version}' $slug")"
  publish 1 2
  in "apt-get update -qq >/dev/null && apt-get install -y -qq --only-upgrade $slug >/dev/null"
  check "$image upgrades to the stable release" "0.0.1" "$(in "dpkg-query -W -f='\${Version}' $slug")"
  in "apt-get purge -y -qq $slug >/dev/null"
  check "$image removes the repository" "gone" "$(in "test -e /etc/apt/sources.list.d/$slug.sources && echo present || echo gone")"
done

latest=$(docker run --rm fedora:latest bash -c '. /etc/os-release; echo "$VERSION_ID"')
for image in "fedora:$latest" "fedora:$((latest - 1))"; do
  docker rm -f repo-test >/dev/null 2>&1 || true
  docker run -d --name repo-test --network host -v "$work:$work:ro" -v "${dirs[0]}:/packages:ro" "$image" sleep 3600 >/dev/null
  in() { docker exec repo-test bash -c "$1"; }
  publish 0
  in "${env_prefix}_REPO_URL=$base dnf install -y -q /packages/*.rpm >/dev/null"
  check "$image installs beta.1 from its file" "0.0.1~beta.1" "$(in "rpm -q --qf '%{VERSION}' $slug")"
  check "$image registers the beta repository" "baseurl=$base/rpm/beta" "$(in "grep baseurl /etc/yum.repos.d/$slug.repo")"
  publish 0 1
  in "dnf upgrade -y -q --refresh $slug >/dev/null"
  check "$image upgrades to beta.2" "0.0.1~beta.2" "$(in "rpm -q --qf '%{VERSION}' $slug")"
  publish 1 2
  in "dnf upgrade -y -q --refresh $slug >/dev/null"
  check "$image upgrades to the stable release" "0.0.1" "$(in "rpm -q --qf '%{VERSION}' $slug")"
  in "dnf remove -y -q $slug >/dev/null"
  check "$image removes the repository" "gone" "$(in "test -e /etc/yum.repos.d/$slug.repo && echo present || echo gone")"
done

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All repository checks passed"
