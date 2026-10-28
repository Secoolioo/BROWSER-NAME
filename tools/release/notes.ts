/**
 * Prints the release notes of a version: its section of CHANGELOG.md, without the heading,
 * followed by the verification hints. Fails when the changelog has no section for it.
 *
 * Usage: node tools/release/notes.ts <version>
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readBrand } from './releases.ts';

const version = process.argv[2];
if (version === undefined) throw new Error('Usage: node tools/release/notes.ts <version>');

const changelog = readFileSync(resolve(import.meta.dirname, '../../CHANGELOG.md'), 'utf8');
const lines = changelog.split(/\r?\n/);
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}`);
const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
const body = lines
  .slice(start + 1, end === -1 ? undefined : end)
  .join('\n')
  .trim();
const brand = readBrand();

console.log(`${body}

---

Every file is listed in \`SHA256SUMS\`, which is signed with the update key (\`SHA256SUMS.sig\`) and the package repository key (\`SHA256SUMS.asc\`). The fingerprints of both keys are in [SECURITY.md](https://github.com/${brand.repository}/blob/main/SECURITY.md). Build provenance can be checked with \`gh attestation verify <file> --repo ${brand.repository}\`.`);
