/**
 * Turns the repository's documentation into website pages before every build. `docs/` stays
 * the only source: each file becomes a page with its first heading as the title, links
 * between Markdown files become links between pages, and nothing generated is committed.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';

const website = resolve(import.meta.dirname, '..');
const root = resolve(website, '..');
const docsSource = join(root, 'docs');
const generated = join(website, 'src', 'content', 'docs', 'docs');

/** The route of a Markdown file below `docs/`, such as `architecture/updates`. */
export function routeOf(file: string): string {
  const withoutExtension = file.replace(/\.md$/i, '');
  const segments = withoutExtension.split('/').map((s) => s.toLowerCase());
  if (segments.at(-1) === 'readme') segments.pop();
  return segments.join('/');
}

/**
 * Rewrites relative links. Links to Markdown files below `docs/` become links to their
 * pages, which are served as folders; links to anything else in the repository point to
 * GitHub.
 * @param markdown - Page content.
 * @param file - Path of the page below `docs/`.
 */
export function rewriteLinks(markdown: string, file: string): string {
  return markdown.replace(
    /\]\((?![a-z]+:|#|\/)([^)\s#]+)(#[^)\s]*)?\)/gi,
    (_match, target: string, anchor: string | undefined) => {
      const resolved = posix.normalize(posix.join(posix.dirname(file), target));
      if (resolved.startsWith('..') || !/\.md$/i.test(resolved)) {
        const inRepository = posix.normalize(posix.join('docs', resolved));
        return `](https://github.com/${repository()}/blob/main/${inRepository}${anchor ?? ''})`;
      }
      const link = posix.relative(routeOf(file), routeOf(resolved));
      return `](${link === '' ? '.' : link}/${anchor ?? ''})`;
    },
  );
}

function repository(): string {
  const brand = JSON.parse(readFileSync(join(root, 'brand.json'), 'utf8')) as {
    repository: string;
  };
  return brand.repository;
}

/**
 * Takes the first level-one heading as the page title and removes it from the body.
 * @param markdown - Page content.
 */
export function splitTitle(markdown: string): { title: string; body: string } {
  const match = /^# (.+)\r?\n/m.exec(markdown);
  if (match === null) throw new Error('Every documentation page needs a "# Title" line');
  return {
    title: match[1]?.trim() ?? '',
    body: markdown.slice(0, match.index) + markdown.slice(match.index + match[0].length),
  };
}

function page(title: string, body: string): string {
  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${body.trimStart()}`;
}

function listMarkdown(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdown(path, base);
    return entry.name.endsWith('.md') ? [relative(base, path).split('\\').join('/')] : [];
  });
}

function main(): void {
  rmSync(generated, { recursive: true, force: true });
  for (const file of listMarkdown(docsSource)) {
    const { title, body } = splitTitle(readFileSync(join(docsSource, file), 'utf8'));
    const target = join(
      generated,
      `${routeOf(file) || 'index'}${file.toLowerCase().endsWith('readme.md') ? '/index' : ''}.md`,
    );
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, page(title, rewriteLinks(body, file)));
  }
  const changelog = join(root, 'CHANGELOG.md');
  if (existsSync(changelog)) {
    const { title, body } = splitTitle(readFileSync(changelog, 'utf8'));
    writeFileSync(join(website, 'src', 'content', 'docs', 'changelog.md'), page(title, body));
  }
  mkdirSync(join(website, 'public'), { recursive: true });
  cpSync(join(root, 'assets', 'brand', 'app-icon.svg'), join(website, 'public', 'favicon.svg'));
  console.log(`Synced the documentation into ${relative(root, generated)}`);
}

main();
