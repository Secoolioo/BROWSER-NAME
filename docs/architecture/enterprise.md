# Enterprise

> **Status:** design. Nothing described here is implemented or released yet. This document describes how Lampo is designed to be deployed and managed in organizations, starting with M1 and growing in later milestones.

Lampo is designed to be manageable: every setting can be set and locked by policy, and the browser will ship with an MSI package, silent installation, update control, a diagnostics page and a safe mode. Organizations will get all of this without telemetry and without an account.

The decisions behind this design are recorded in ADR 0003 (packaging with electron-builder), ADR 0012 (policy providers per OS) and ADR 0014 (update architecture with a signed feed). See the [decision records](../adr/README.md).

Related documents:

- [Settings, policies and themes](settings-policy-theme.md): how settings and policies are defined, resolved and generated.
- [Updates](updates.md): the signed update feed, channels and rollback.
- [Security](security.md): permissions, certificates and network hardening.
- [Testing](testing.md): how the policy providers and packages are tested.

## Policy sources

| Platform | Source                                                                                                                                                                                                                      | Typical delivery                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Windows  | Registry keys `HKLM\SOFTWARE\Policies\Lampo` and `HKCU\SOFTWARE\Policies\Lampo` for mandatory policies; `HKLM\SOFTWARE\Policies\Lampo\Recommended` and `HKCU\SOFTWARE\Policies\Lampo\Recommended` for recommended policies. | Group Policy with the ADMX/ADML templates, Microsoft Intune. |
| macOS    | Managed preferences (`/Library/Managed Preferences`) for the bundle ID `io.github.secoolioo.lampo`.                                                                                                                         | Configuration profiles through MDM, for example Jamf.        |
| Linux    | `/etc/lampo/policies/managed/*.json` for mandatory policies and `/etc/lampo/policies/recommended/*.json` for recommended policies. Files are merged in alphabetical order.                                                  | Any tool that can place files on the system.                 |

The ADMX namespace is `Lampo.Policies`. The namespace, the registry paths, the bundle ID and the Linux paths derive from `brand.json`. The product name may still change before 1.0; from 1.0 on, these identifiers will never change.

Policy names follow Chrome's names where that makes sense, so that existing knowledge and tooling carry over.

## Precedence

- **Mandatory over recommended.** A mandatory policy locks a setting; a recommended policy only changes the value users start from.
- **Machine over user.** On Windows, `HKLM` takes precedence over `HKCU`.
- **Sensitive policies only from trusted sources.** The update URL (`UpdateURL`), the proxy policies, the default search provider policies and, from M4, extension sources apply only from `HKLM` on Windows and only as forced values on macOS. Linux policy files are system-wide by location. If a sensitive policy appears anywhere else, it will not apply, and the diagnostics page will show a warning. This keeps a program running as the user from redirecting updates or traffic by writing to `HKCU`. Chrome and Firefox follow the same principle (as of October 2026).

How policies combine with defaults, user values and workspace overrides is described in the [resolution order](settings-policy-theme.md#resolution-order).

## Reading policies

In M1, Lampo is designed to read every policy source without a native module, synchronously, before the app is ready:

- **Windows:** `reg export` writes the policy keys of `HKLM` and `HKCU` to a temporary file, which is then parsed. The export is UTF-16LE, so non-ASCII characters survive intact.
- **macOS:** `plutil -convert xml1 -o -` converts the managed preferences plists to XML, which is then parsed. XML is used instead of JSON because plist dates and binary data (`<date>` and `<data>`) cannot be converted to JSON.
- **Linux:** the JSON files are read directly.

Reading has a measured budget of at most 60 ms. The last known policy set is cached and used as a fallback when a source cannot be read. Policies will be read again when the browser gains focus and every 15 minutes.

In M5, a native Node-API addon is planned. It will use `RegisterGPNotification` on Windows to be notified of Group Policy changes and `CFPreferencesAppValueIsForced` on macOS to tell forced values apart.

## M1 policy set

M1 is designed to ship about 22 policies:

| Group    | Policies                                                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Update   | `UpdatePolicy`, `TargetChannel`, `TargetVersionPrefix`, `UpdateURL` (mirror), `AutoUpdateCheckPeriodMinutes`                                                                                                         |
| Network  | `ProxyMode`, `ProxyPacUrl`, `ProxyServer`, `ProxyBypassList`, `DnsOverHttpsMode`, `DnsOverHttpsTemplates`, `AuthServerAllowlist`                                                                                     |
| Content  | `URLBlocklist`, `URLAllowlist`, `HomepageLocation`, `RestoreOnStartup` with `RestoreOnStartupURLs`, `NewTabPageLocation`, the `DefaultSearchProvider*` policies                                                      |
| Features | `PrivateModeAvailability`, `DeveloperToolsAvailability`, `DownloadDirectory`, `PromptForDownloadLocation`, `SafeModeAvailability`, and `<Module>Enabled` for every optional module (for example `WorkspacesEnabled`) |
| Locks    | Every setting with a `policy` attribute is automatically a policy. In addition, `ManagedSettings` takes JSON that sets settings by key, each with a `Status` of `locked` or `default`.                               |

`UpdatePolicy` takes one of three values:

| Value | Meaning                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------- |
| `0`   | Off. The in-app updater does not run.                                                           |
| `1`   | Automatic. Updates are checked, downloaded and installed as described in [Updates](updates.md). |
| `2`   | Manual only. Updates are not applied automatically; they run only when started by hand.         |

`TargetChannel` selects `stable` or `beta`. `TargetVersionPrefix` pins updates to the highest version in the feed that matches the prefix. `UpdateURL` points the browser to a mirror of the update feed and packages.

## Later policy groups

| Milestone       | Policies                                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M2 Flow         | `HttpsOnlyMode`, `AuthNegotiateDelegateAllowlist`, `ManagedBookmarks`, `SpellcheckDictionaryURL`, cookie policies, `ClearBrowsingDataOnExit`, `PasswordManagerEnabled`, import policies, `CACertificates`, `SSLErrorOverrideAllowed`, capture policies and printing policies. Also a Jamf JSON schema. |
| M4 Ecosystem    | Extension policies, for example `ExtensionInstallBlocklist`.                                                                                                                                                                                                                                           |
| M5 Enterprise+  | `RollbackToTargetVersion` and an update maintenance window, as part of an extended set of more than 50 policies.                                                                                                                                                                                       |
| M6 Sync and 1.0 | Sync policies.                                                                                                                                                                                                                                                                                         |

## Network: proxy, DNS, certificates and single sign-on

### Proxy

The proxy defaults to the system configuration. When the proxy policies are set, the browser is designed to apply them through `session.setProxy` and then close all existing connections (`closeAllConnections`), so no connection keeps using the old route.

### DNS over HTTPS

Electron starts with DNS over HTTPS turned off (as of October 2026), so Lampo is designed to configure the host resolver explicitly (`configureHostResolver`). The default is `automatic` with a list of providers. With `DnsOverHttpsMode`, administrators can choose `off` or `secure`, and `DnsOverHttpsTemplates` sets their own resolver templates.

### Certificates

- Lampo is designed to trust the Chrome Root Store plus root certificates that are trusted locally by the operating system.
- On Windows and macOS, locally trusted roots are picked up automatically. On Linux, they come from the NSS database; the admin guide will document the `certutil` steps.
- Client certificates are never selected automatically; the user always chooses one.
- Certificate errors lead to Lampo's own interstitial page.
- From M2, `CACertificates` and `SSLErrorOverrideAllowed` give administrators direct control.

The root store, CRLSet and certificate transparency data are updated only with Electron updates. This is why Lampo commits to a fixed response time for security updates, described in [Security](security.md).

### Single sign-on

Kerberos (Negotiate) and NTLM are designed to work through allowlist policies together with Electron's `allowNTLMCredentialsForDomains`:

- `AuthServerAllowlist` will be mapped internally to Electron's command-line switch `auth-server-whitelist` (as of October 2026). The switch has to be set before the app is ready, which is one reason why policies are read synchronously at startup.
- From M2, `AuthNegotiateDelegateAllowlist` will be mapped the same way to `auth-negotiate-delegate-whitelist` (as of October 2026).

### Network tests

The network features are designed to be tested automatically:

- every proxy mode, including a local PAC file, against a test proxy;
- DNS over HTTPS against a local DNS over HTTPS stub;
- Kerberos and Negotiate against an MIT KDC and a web server in a container on Linux;
- a custom root certificate authority in the Windows certificate store and in the NSS database on Linux.

## MSI package

Lampo is designed to ship a native MSI package (not a wrapped installer) for managed Windows deployments:

- **Per machine.** `perMachine: true` installs for all users (`ALLUSERS=1`).
- **Fixed upgrade code.** The `upgradeCode` is set explicitly and never changes. Major upgrades replace the previous version, with downgrade protection.
- **Silent.** Silent installation runs `msiexec /i` with `/qn /norestart /l*v` and needs no restart.
- **Properties.** `INSTALLDIR` sets the installation folder, and `DESKTOP_SHORTCUT=0` turns off the desktop shortcut. Both are added through electron-builder's `msiProjectCreated` hook, already in M1.
- **Install type marker.** The installation type is recorded outside the policy keys, at `HKLM\SOFTWARE\Lampo\Install` with `Type=msi`. When the browser finds it, the in-app updater will stay off; IT distributes new MSI packages, for example through Group Policy, Intune or SCCM, and controls update behavior with `UpdatePolicy`.
- **Rollback.** Rollback is an IT task; the `ALLOWDOWNGRADE` property allows a deliberate downgrade.
- **Clean uninstall.** Uninstalling removes the installation cleanly. Intune detection by ProductCode will be documented.
- **Stable releases only.** Windows Installer ignores prerelease identifiers in version numbers, so beta releases are not published as MSI.
- **x64 in M1.** For arm64, electron-builder produces an MSI that is marked as x64 (as of October 2026). A dedicated WiX template is designed to follow in M5; until then, arm64 devices use the NSIS installer.

In M5, an optional elevated update task (running as SYSTEM) is designed to install verified MSI packages silently.

## Diagnostics page

The diagnostics page (`app://diagnostics`) is designed to show everything support and administrators need, without sending anything anywhere:

| Section   | Contents                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| Version   | App, Electron, Chromium, Node and V8 versions; update channel; installation type; paths; command line.         |
| Policies  | For each policy: value, source, scope, level, status and error. A button to reload policies and a JSON export. |
| Modules   | Which modules are active and how long they took to load.                                                       |
| Updates   | Updater status, feed and signature state.                                                                      |
| Processes | Process metrics.                                                                                               |
| Support   | Copy as text or JSON (redacted) and a diagnostics ZIP file including the logs. Nothing is sent automatically.  |

Logs are designed to be local only: JSON Lines files under `logs/`, rotated at 5 MB with three files kept. Crash dumps also stay local; they can be viewed on the diagnostics page and shared manually.

## Safe mode

Safe mode is designed to help when a module, a theme or the GPU prevents normal use:

- **Start:** with `--safe-mode`, a Jump List entry on Windows, a `.desktop` action on Linux or the Dock menu on macOS. From M2, the browser is designed to enter safe mode automatically after two failed starts that were not preceded by an update.
- **Effect:** optional modules and custom themes are turned off, and optionally GPU acceleration as well. The security guards in the kernel stay active, so permissions remain denied by default.
- **Control:** administrators can turn safe mode off with `SafeModeAvailability`.

## Accessibility

- **Target:** WCAG 2.2 AA for Lampo's own user interface, and EN 301 549 clause 11.
- **Test matrix:** NVDA, JAWS, Narrator, VoiceOver and Orca; Forced Colors; keyboard-only use; target size of at least 24 × 24 px.
- **Manual checks:** maintainers run a screen reader smoke test with NVDA, VoiceOver and Orca once per minor release.
- **Conformance report:** a VPAT 2.5 INT is planned from M5.

The visual rules behind these targets are described in the [design system](design-system.md).

## Outgoing connections

By design, Lampo collects no telemetry and uploads no crash reports. Every outgoing connection is designed to be documented, listed on the diagnostics page, and redirected or turned off by policy:

- **Updates:** the update feed on the project website and the packages on GitHub Releases.
- **Content blocker (M2):** the filter list feed.
- **Spell checking:** dictionaries are self-hosted from M2. In M1, spell checking is off on Windows and Linux, so nothing reaches third-party dictionary servers; macOS uses the system spell checker.
- **Search suggestions:** opt-in.

## Admin guide

An admin guide (v1) is planned for M1. It will cover:

- **Installation:** MSI, NSIS, macOS (dmg, without a `.pkg` installer), deb and rpm, including silent installation flags.
- **Policy reference:** generated from the setting and policy definitions, with examples for Group Policy, Intune (ADMX import and OMA-URI), Jamf and Linux.
- **Updates:** update control and running a mirror.
- **Network:** proxy, certificates and single sign-on.
- **Operations:** logs, the diagnostics page, safe mode and the list of outgoing connections.

## Acceptance criteria

The M1 acceptance tests for enterprise features are:

- The MSI installs, upgrades and uninstalls silently per machine, each with exit code 0.
- Policies set through the registry, plists and JSON files take effect and appear on `app://diagnostics`.
- Settings locked by policy cannot be changed in the UI or through the API and are shown as managed.
- The ADMX/ADML templates validate against the XSD automatically. Maintainers check the import into a Microsoft Intune test tenant manually once per minor release.
- `--safe-mode` starts without optional modules and custom themes.
- The policy providers are tested against real sources: a test key under `HKCU` on Windows, a plist in `/Library/Managed Preferences` on macOS and JSON files in a temporary folder on Linux.
