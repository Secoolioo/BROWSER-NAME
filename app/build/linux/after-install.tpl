#!/bin/bash
# Runs after the deb or rpm package is installed or upgraded. The first part is
# electron-builder's after-install template (MIT License, Copyright (c) 2015 Loopline
# Systems); the last part registers the package repository. electron-builder replaces the
# dollar-brace macros; @SLUG@, @PRODUCT@ and @WEBSITE@ come from brand.json.

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install apparmor profile. (Ubuntu 24+)
# First check if the version of AppArmor running on the device supports our profile.
# This is in order to keep backwards compatibility with Ubuntu 22.04 which does not support abi/4.0.
# In that case, we just skip installing the profile since the app runs fine without it on 22.04.
#
# Those apparmor_parser flags are akin to performing a dry run of loading a profile.
# https://wiki.debian.org/AppArmor/HowToUse#Dumping_profiles
#
# Unfortunately, at the moment AppArmor doesn't have a good story for backwards compatibility.
# https://askubuntu.com/questions/1517272/writing-a-backwards-compatible-apparmor-profile
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

    # Updating the current AppArmor profile is not possible and probably not meaningful in a chroot'ed environment.
    # Use cases are for example environments where images for clients are maintained.
    # There, AppArmor might correctly be installed, but live updating makes no sense.
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      # Extra flags taken from dh_apparmor:
      # > By using '-W -T' we ensure that any abstraction updates are also pulled in.
      # https://wiki.debian.org/AppArmor/Contribute/FirstTimeProfileImport
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi

# Register the signed package repository once, so the browser updates together with the
# system: APT on Debian and Ubuntu, DNF on Fedora and RHEL. Prereleases use the beta channel,
# which also receives stable releases. Set @ENV@_NO_REPO=1 to skip this, or @ENV@_REPO_URL to
# use a mirror. An existing source file is never overwritten.
REPO_KEY='/opt/${sanitizedProductName}/resources/linux-repo.asc'
REPO_URL="$@ENV@_REPO_URL"
[ -n "$REPO_URL" ] || REPO_URL='@WEBSITE@'
REPO_URL="$(printf '%s' "$REPO_URL" | sed 's:/*$::')"
if [ "$@ENV@_NO_REPO" != 1 ] && [ -f "$REPO_KEY" ]; then
  if dpkg-query -W '@SLUG@' >/dev/null 2>&1; then
    VERSION="$(dpkg-query -W -f='$'"{Version}" '@SLUG@')"
    case "$VERSION" in *~*) CHANNEL=beta ;; *) CHANNEL=stable ;; esac
    if [ -d /etc/apt/sources.list.d ] && [ ! -e '/etc/apt/sources.list.d/@SLUG@.sources' ]; then
      install -D -m 0644 "$REPO_KEY" '/usr/share/keyrings/@SLUG@.asc'
      printf 'Types: deb\nURIs: %s/apt\nSuites: %s\nComponents: main\nSigned-By: /usr/share/keyrings/@SLUG@.asc\n' \
        "$REPO_URL" "$CHANNEL" >'/etc/apt/sources.list.d/@SLUG@.sources'
    fi
  elif rpm -q '@SLUG@' >/dev/null 2>&1; then
    VERSION="$(rpm -q --qf '%{VERSION}' '@SLUG@')"
    case "$VERSION" in *~*) CHANNEL=beta ;; *) CHANNEL=stable ;; esac
    if [ -d /etc/yum.repos.d ] && [ ! -e '/etc/yum.repos.d/@SLUG@.repo' ]; then
      printf '[@SLUG@]\nname=@PRODUCT@\nbaseurl=%s/rpm/%s\nenabled=1\ngpgcheck=1\nrepo_gpgcheck=1\ngpgkey=file://%s\n' \
        "$REPO_URL" "$CHANNEL" "$REPO_KEY" >'/etc/yum.repos.d/@SLUG@.repo'
    fi
  fi
fi
