#!/bin/bash
# Runs after the deb or rpm package is removed or upgraded. The first part is
# electron-builder's after-remove template (MIT License, Copyright (c) 2015 Loopline
# Systems); the last part removes the package repository when the package is removed for
# good. @SLUG@ comes from brand.json.

# Delete the link to the binary
# update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
# not the generic symlink — see https://man7.org/linux/man-pages/man1/update-alternatives.1.html
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the
  # policy is not left enforced until the next reboot.  Mirror the chroot guard
  # used in the after-install script — live AppArmor operations are not
  # meaningful inside a chroot.
  # https://wiki.debian.org/AppArmor/HowToUse
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi

# deb passes "remove" or "purge", rpm passes 0 on removal; upgrades keep the repository.
case "$1" in
  remove | purge | 0)
    rm -f '/etc/apt/sources.list.d/@SLUG@.sources' '/usr/share/keyrings/@SLUG@.asc' \
      '/etc/yum.repos.d/@SLUG@.repo'
    ;;
esac
