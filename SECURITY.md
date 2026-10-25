# Security policy

## Supported versions

Security fixes are released for the latest version only, on both the stable and the beta channel. Please update to the newest release before reporting.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: **[Report a vulnerability](https://github.com/Secoolioo/lampo/security/advisories/new)**. Do not open a public issue.

Please include:

- the Lampo version, operating system and installation type,
- the steps to reproduce, or a proof of concept,
- the impact you expect.

## What to expect

- We confirm your report within 7 days and share a first assessment within 14 days.
- We fix confirmed issues as fast as their severity requires and coordinate the disclosure date with you.
- We credit you in the advisory unless you prefer otherwise.

Vulnerabilities in Chromium or Electron are fixed upstream. We ship the upstream fix as a patch release, usually within 72 hours of its publication.

## Release integrity

Every release includes a `SHA256SUMS` file signed with the project's update key, a software bill of materials and build provenance attestations. The public keys and verification steps are published together with the first release.
