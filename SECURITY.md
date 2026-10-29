# Security policy

## Supported versions

Security fixes are released for the latest version only, on both the stable and the beta channel. Please update to the newest release before reporting.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: **[Report a vulnerability](https://github.com/Secoolioo/astela/security/advisories/new)**. Do not open a public issue.

Please include:

- the Astela version, operating system and installation type,
- the steps to reproduce, or a proof of concept,
- the impact you expect.

## What to expect

- We confirm your report within 7 days and share a first assessment within 14 days.
- We fix confirmed issues as fast as their severity requires and coordinate the disclosure date with you.
- We credit you in the advisory unless you prefer otherwise.

Vulnerabilities in Chromium or Electron are fixed upstream. We ship the upstream fix as a patch release, usually within 72 hours of its publication.

## Release integrity

Every release includes a `SHA256SUMS` file, a software bill of materials and build provenance attestations. `SHA256SUMS` is signed twice: with the update key (`SHA256SUMS.sig`, a base64 Ed25519 signature) and with the package repository key (`SHA256SUMS.asc`, OpenPGP).

| Key                    | Use                                                                                                                                                                           | Fingerprint                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Update key             | Signs the update feed and `SHA256SUMS.sig`. Public key: [`app/build/keys/update-current.pub.pem`](app/build/keys/update-current.pub.pem)                                      | SHA-256 of the public key: `705aab554e3f4f876a35d5bf1c3bbcf491e90bc8c5a6903c8adaa5b48009318e`              |
| Next update key        | Built into the browser for a key rotation and kept offline until then. Public key: [`app/build/keys/update-next.pub.pem`](app/build/keys/update-next.pub.pem)                 | SHA-256 of the public key: `3d9f10c502634dc6caa070f07900bff384fb2cb01160428fe38098e71168f351`              |
| Package repository key | Signs the APT and DNF metadata, the rpm packages and `SHA256SUMS.asc`. Public key: [`app/build/keys/linux-repo.pub.asc`](app/build/keys/linux-repo.pub.asc)                   | `521D 75B0 23B8 83F5 91C4 CB17 FD2A 08B7 9E93 F41F`                                                        |
| macOS code signing     | Self-signed certificate that signs the macOS app until an Apple Developer ID replaces it. Certificate: [`app/build/keys/macos-signing.crt`](app/build/keys/macos-signing.crt) | SHA-256: `A3:52:B3:DB:FB:A3:B8:19:95:8D:5A:92:9B:AF:83:B0:20:60:94:03:4B:CD:39:59:C8:D3:BB:64:3C:01:13:44` |

To verify a download, put it next to `SHA256SUMS`, `SHA256SUMS.sig` and `SHA256SUMS.asc` from the same release and use the public keys from `app/build/keys/` in this repository:

```sh
sha256sum --check --ignore-missing SHA256SUMS
gpg --import app/build/keys/linux-repo.pub.asc
gpg --verify SHA256SUMS.asc SHA256SUMS
base64 -d SHA256SUMS.sig >SHA256SUMS.sig.bin
openssl pkeyutl -verify -pubin -inkey app/build/keys/update-current.pub.pem -rawin -in SHA256SUMS -sigfile SHA256SUMS.sig.bin
gh attestation verify <file> --repo Secoolioo/astela
```

On macOS, compare the certificate that signed the installed app with the fingerprint above:

```sh
codesign --display --extract-certificates /Applications/Astela.app
openssl x509 -inform DER -in codesign0 -noout -fingerprint -sha256
```
