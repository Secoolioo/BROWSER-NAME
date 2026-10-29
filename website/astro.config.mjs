// The public website. Documentation comes from docs/ through scripts/sync-docs.ts, the API
// reference from the app's sources through TypeDoc; see docs/adr/0020.
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { existsSync, readFileSync } from 'node:fs';
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
// Release data exists only in the Pages deployment (tools/release/collect.ts). Without it there
// is no download page, so nothing links to packages that do not exist.
const hasReleases = existsSync(new URL('./src/data/releases.json', import.meta.url));
const downloadPage = {
  name: 'download-page',
  hooks: {
    'astro:config:setup': ({ injectRoute }) => {
      if (hasReleases) {
        injectRoute({ pattern: '/download', entrypoint: './src/routes/download.astro' });
      }
    },
  },
};

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
      customCss: ['./src/styles/theme.css'],
      expressiveCode: {
        styleOverrides: { borderRadius: '4px', frames: { frameBoxShadowCssValue: 'none' } },
      },
      social: [{ icon: 'github', label: 'Source code', href: repository }],
      lastUpdated: false,
      pagination: false,
      components: { Footer: './src/components/Footer.astro' },
      sidebar: [
        ...(hasReleases ? [{ label: 'Download', link: '/download/' }] : []),
        ...(existsSync(new URL('../CHANGELOG.md', import.meta.url))
          ? [{ label: 'Changelog', link: '/changelog/' }]
          : []),
        { label: 'User guide', items: [{ autogenerate: { directory: 'docs/user' } }] },
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
          typeDoc: { ...typeDoc, outputFileStrategy: 'modules' },
        }),
      ],
    }),
    downloadPage,
  ],
});
