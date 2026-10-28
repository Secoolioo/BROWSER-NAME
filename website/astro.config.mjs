// The public website. Documentation comes from docs/ through scripts/sync-docs.ts, the API
// reference from the app's sources through TypeDoc; see docs/adr/0020.
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';

const brand = JSON.parse(readFileSync(new URL('../brand.json', import.meta.url), 'utf8'));
const website = new URL(brand.website);
const repository = `https://github.com/${brand.repository}`;
// The same options as the strict check in `pnpm check:api`.
const {
  $schema: _schema,
  entryPoints,
  tsconfig,
  ...typeDoc
} = JSON.parse(readFileSync(new URL('./typedoc.json', import.meta.url), 'utf8'));

export default defineConfig({
  site: website.origin,
  base: website.pathname,
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: brand.productName,
      description: brand.tagline,
      logo: { src: '../assets/brand/app-icon.svg' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'Source code', href: repository }],
      lastUpdated: false,
      pagination: false,
      components: { Footer: './src/components/Footer.astro' },
      sidebar: [
        { label: 'Roadmap', link: '/docs/roadmap/' },
        { label: 'Architecture', items: [{ autogenerate: { directory: 'docs/architecture' } }] },
        { label: 'Decision records', items: [{ autogenerate: { directory: 'docs/adr' } }] },
        { label: 'Maintainers', items: [{ autogenerate: { directory: 'docs/maintainers' } }] },
        typeDocSidebarGroup,
      ],
      plugins: [
        starlightTypeDoc({
          entryPoints,
          tsconfig,
          output: 'api',
          sidebar: { label: 'API reference', collapsed: true },
          typeDoc,
        }),
      ],
    }),
  ],
});
