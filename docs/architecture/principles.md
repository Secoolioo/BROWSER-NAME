# Principles

> **Status:** these principles apply to every design decision, pull request and review. Astela is in early development; nothing described here is released yet.

Astela aims to be a browser that feels like your own tool: it starts instantly, uses little memory and adapts to the way you work. Apart from that, it leaves you alone. Eight principles turn that vision into rules that can be checked.

## The eight principles

### 1. Performance first

Performance is a feature, and it is measured rather than claimed. Budgets for start-up time, memory, idle CPU, switching speed and package size run as CI gates, and any regression fails the build. See [performance](performance.md).

### 2. Lean by design

Astela is a microkernel with feature modules. A module that is switched off is never imported, so it costs neither start-up time nor memory. Every new dependency needs a reason in its pull request; a dependency larger than 20 KB gzipped in the UI, or one with native code, needs an architecture decision record. See [modules](modules.md).

### 3. Customization at the core

Settings, themes, policies, shortcuts and the toolbar are declarative and schema-based. One source generates the settings UI, the documentation, the JSON Schema and the ADMX templates, so they cannot drift apart. See [settings, policies and themes](settings-policy-theme.md).

### 4. Calm

The browser does not interrupt. Modal dialogs are reserved for security decisions. There are no ads, no sponsored tiles, no news feeds, no upselling and no nag screens.

### 5. Private by default

There is no telemetry, and no account is required. A content blocker is part of the browser (planned for M2, see the [roadmap](../roadmap.md)). Data stays on the device, and secrets are kept in the operating system's key store.

### 6. Manageable

Every setting can be set and locked by policy. Organizations get an MSI package, silent installation and control over updates. See [enterprise](enterprise.md).

### 7. Secure

Astela relies on the Chromium sandbox, process isolation, validated IPC and signed updates. Security patches follow a fixed service level: an Electron security fix leads to an Astela patch release within 72 hours, with a target of 24 hours for critical issues. See [security](security.md).

### 8. Honest

Only real numbers, badges and screenshots. Performance figures come from CI measurements, screenshots come from the real app, and every feature is documented and tested.

## Target groups

| Group                                  | Needs most                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Power users and developers             | Workspaces, vertical tabs, a command palette, custom shortcuts, split view.                                |
| Everyday users who want speed and calm | Fast start-up, a built-in blocker, no distractions, a clear interface.                                     |
| Designers and customizers              | Themes, a theme editor, layouts, density, fonts.                                                           |
| Users on low-end hardware              | Low memory use, tab sleep, little CPU use when idle.                                                       |
| Organizations and IT departments       | Policies (Group Policy, Intune, MDM, JSON), MSI, update channels and mirrors, proxy and SSO, no telemetry. |

## Non-goals

No bundled third-party services, no feeds and no sponsored content; no own rendering engine and no engine fork; no mobile apps for now.

## Related documents

- [Architecture overview](overview.md)
- [Roadmap](../roadmap.md)
- [Architecture decision records](../adr/README.md)
