/**
 * Architecture rules for app/src. The layers and their allowed directions are described
 * in docs/architecture/overview.md.
 * @type {import('dependency-cruiser').IConfiguration}
 */
const layer = (name) => `^app/src/${name}/`;

/** Layers each layer may import from, besides itself. */
const allowed = {
  shared: [],
  kernel: ['shared'],
  domain: ['kernel', 'shared'],
  platform: ['domain', 'kernel', 'shared'],
  'modules-main': ['domain', 'kernel', 'shared'],
  preload: ['shared'],
  ui: ['shared'],
  main: ['modules', 'platform', 'domain', 'kernel', 'shared'],
};
const layers = ['shared', 'kernel', 'domain', 'platform', 'preload', 'ui', 'main'];

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules impossible to load or test in isolation.',
      from: {},
      to: { circular: true },
    },
    ...layers.map((name) => ({
      name: `layer-${name}`,
      severity: 'error',
      comment: `${name}/ may only import from: ${allowed[name].join(', ') || 'itself'}.`,
      from: { path: layer(name), pathNot: '/__tests__/' },
      to: {
        path: '^app/src/',
        pathNot: [layer(name), ...allowed[name].map(layer)],
      },
    })),
    {
      name: 'layer-modules-main',
      severity: 'error',
      comment: 'Browser-process code of a module may only use domain, kernel and shared.',
      from: { path: '^app/src/modules/[^/]+/main/' },
      to: {
        path: '^app/src/(platform|main|preload|ui)/',
      },
    },
    {
      name: 'modules-only-through-api',
      severity: 'error',
      comment: "A module may use another module only through that module's api/ folder.",
      from: { path: '^app/src/modules/([^/]+)/' },
      to: {
        path: '^app/src/modules/([^/]+)/',
        pathNot: ['^app/src/modules/$1/', '^app/src/modules/[^/]+/api/'],
      },
    },
    {
      name: 'electron-only-at-the-edges',
      severity: 'error',
      comment: 'Only platform/, main/ and preload/ may import Electron.',
      from: { path: '^app/src/', pathNot: '^app/src/(platform|main|preload)/' },
      to: {
        path: '^electron$',
        dependencyTypes: ['npm', 'npm-dev', 'core', 'unknown', 'undetermined'],
      },
    },
    {
      name: 'no-node-in-pure-layers',
      severity: 'error',
      comment: 'shared/, kernel/, domain/ and ui/ must not use Node built-ins.',
      from: { path: '^app/src/(shared|kernel|domain|ui)/', pathNot: '/__tests__/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'tests-stay-in-tests',
      severity: 'error',
      comment: 'Production code must not import test code or test libraries.',
      from: { path: '^app/src/', pathNot: '/__tests__/' },
      to: { path: ['/__tests__/', '^vitest$', '^fast-check$', '^@playwright/'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(\\.tsbuild|dist|node_modules)/' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.ts', '.js'] },
  },
};
