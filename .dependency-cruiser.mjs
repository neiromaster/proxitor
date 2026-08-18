/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: 'plugin-api-no-internal-imports',
      comment: 'plugin-api must not depend on proxy-core (spec §3.2)',
      severity: 'error',
      from: { path: '^packages/plugin-api/src' },
      to: { path: '^packages/proxy-core' },
    },
    {
      name: 'plugin-api-runtime-deps-locked',
      comment: 'plugin-api is zero-deps at runtime; zod is the only allowed (peer)',
      severity: 'error',
      from: { path: '^packages/plugin-api/src' },
      to: { dependencyTypes: ['npm'], pathNot: '^zod$' },
    },
    {
      name: 'core-layers-no-adapter-leak',
      comment: 'domain/application/formats/plugins must not import adapters (spec §3.2)',
      severity: 'error',
      from: { path: '^packages/proxy-core/src/(domain|application|formats|plugins)' },
      to: { path: '^packages/proxy-core/src/adapters' },
    },
    {
      name: 'adapters-application-only',
      comment: 'adapters talk to the core through application ports only (spec §3.2)',
      severity: 'error',
      from: { path: '^packages/proxy-core/src/adapters' },
      to: { path: '^packages/proxy-core/src/(domain|formats|plugins)' },
    },
  ],
};
