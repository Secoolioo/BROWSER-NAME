# 0012. Policy providers per OS

## Status

Accepted

## Date

2026-10-25

## Context

Organizations configure browsers with the tools of each operating system: Group Policy and Intune write the Windows registry, MDM systems install configuration profiles on macOS, and Linux fleets distribute files. Some policies must take effect before Electron is ready, because they map to Chromium switches that can only be set early: the authentication server allowlist, hardware acceleration and feature flags. The settings in [ADR 0011](0011-settings-schema-as-single-source.md) define what can be set by policy; this record defines where policies are read from and how.

Reading the registry or managed preferences natively would require a native Node module, which has to be built for every Electron ABI and architecture. The first milestone avoids native code.

## Decision

A `PolicyService` merges the results of one `IPolicyProvider` per operating system. All paths and identifiers derive from `brand.json` (currently `Lampo`, `lampo` and the bundle ID `io.github.secoolioo.lampo`); after 1.0 they never change.

| Provider                        | Sources                                                                                                | Reading method                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `WindowsRegistryPolicyProvider` | `HKLM\SOFTWARE\Policies\Lampo` before `HKCU\SOFTWARE\Policies\Lampo`, each with a `Recommended` subkey | `reg export` of the policy keys into a temporary file, parsed as UTF-16LE so that non-ASCII values survive       |
| `MacManagedPrefsPolicyProvider` | Managed Preferences for the bundle ID, installed through configuration profiles                        | `plutil -convert xml1 -o -` on the managed plists; XML because JSON conversion fails on `date` and `data` values |
| `LinuxJsonPolicyProvider`       | `/etc/lampo/policies/managed/*.json` and `/etc/lampo/policies/recommended/*.json`                      | JSON files merged in alphabetical order                                                                          |

- **Timing:** policies load synchronously before `app.whenReady()`, within a measured budget of 60 ms. The last known policy state is cached and used as a fallback if reading fails. The shell renders only from the merged settings snapshot, so nothing visibly changes after the first paint.
- **Refresh:** policies are re-read when a window gains focus and every 15 minutes. Changes to policies that map to early Chromium switches take effect after a restart, and the UI says so.
- **Precedence:** mandatory before recommended, machine before user. Sensitive policies (update URL, proxy, search engine, extension sources) are accepted only from `HKLM` on Windows or as forced values on macOS; otherwise they are ignored with a warning.
- **Errors:** invalid policies are ignored and listed with value, source, scope, level, status and error on `app://diagnostics`.
- **Templates:** the ADMX namespace is `Lampo.Policies` and is never renamed after 1.0.
- **Policy kinds:** setting policies are generated for every setting with a `policy` attribute; standalone policies such as `UpdatePolicy`, `URLBlocklist` and `AuthServerAllowlist` are defined directly. The full first-milestone set is described in the [enterprise architecture](../architecture/enterprise.md).
- **Later:** a Node-API addon using `RegisterGPNotification` on Windows and `CFPreferencesAppValueIsForced` on macOS follows in M5 for change notifications and exact forced-value detection.

## Consequences

Positive:

- Policies work with existing administration tools on every platform without native code in the first milestone.
- Early policies take effect for Chromium switches, and users never see a policy-controlled value switch after start-up.
- Restricting sensitive policies to machine scope follows the same protection against registry hijacking that Chrome and Firefox use.
- Integration tests can exercise each provider against real sources: a test key under `HKCU` on Windows, a plist in `/Library/Managed Preferences` on the macOS runner, and JSON files in a temporary directory on Linux ([ADR 0022](0022-test-strategy.md)).

Negative:

- Spawning `reg` and `plutil` costs start-up time, which is why the 60 ms budget is measured in CI ([ADR 0017](0017-performance-budgets-in-ci.md)).
- Without native notifications, policy changes are noticed only on focus or after up to 15 minutes until M5.
- Parsing exported registry files and plists is more fragile than native APIs and needs tests with non-ASCII values and every value type.

## Alternatives considered

- **A native addon from the start:** precise and event-driven, but requires a build per ABI and architecture; deferred to M5.
- **One JSON file on every operating system:** simple, but incompatible with Group Policy, Intune and MDM tooling.
- **PowerShell or `defaults read`:** PowerShell starts too slowly for the start-up path, and the output of `defaults` is not a stable, parseable format.
- **Loading policies asynchronously after `ready`:** faster start, but early Chromium switches could not be controlled, and the UI would visibly change once policies arrive.
