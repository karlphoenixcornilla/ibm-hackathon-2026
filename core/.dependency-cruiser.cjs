// .dependency-cruiser.cjs — boundary rules for @reprise/core
// Spec: 00-base.md §B7
//
// Rule summary:
//   - src/<module>/**  may only import:  src/contracts/**, src/util/**, itself
//   - src/core.ts, src/index.ts may import across all modules (composition root, public entry)
//   - src/fakes/**     may import across all modules (test doubles)
//   - src/providers/** may NOT import src/exec/** (provider boundary: providers never execute)

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ── Cross-module imports (the main boundary rule) ────────────────────────
    // A module folder may only import contracts/, util/, or its own folder.
    // Exceptions: fakes/ (test doubles); src/core.ts and src/index.ts sit outside module folders.
    {
      name: 'no-cross-module-import',
      comment:
        'A module may only import src/contracts/, src/util/, and its own folder. ' +
        'Cross-module calls must go through the Services interface. ' +
        'Only src/core.ts, src/index.ts and src/fakes/ may import across modules.',
      severity: 'error',
      from: {
        path: '^src/(?!(?:contracts|util|fakes)/)(exec/[^/]+|[^/]+)/',
      },
      to: {
        path: '^src/',
        pathNot: [
          '^src/contracts/',
          '^src/util/',
          // Match the module captured in from.path, including exec/local or exec/ci.
          '^src/$1/',
        ],
      },
    },

    // ── providers may not import exec/ ──────────────────────────────────────
    {
      name: 'no-providers-importing-exec',
      comment:
        'Providers must never import from exec/. ' +
        'Providers produce reasoning output only; they never execute tests. ' +
        'Spec: 01-architecture/architecture.md §Boundaries',
      severity: 'error',
      from: { path: '^src/providers/' },
      to: { path: '^src/exec/' },
    },

    // ── No circular dependencies ─────────────────────────────────────────────
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },

    // ── No orphan files ──────────────────────────────────────────────────────
    {
      name: 'no-orphans',
      severity: 'warn',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', 'src/index\\.ts'] },
      to: {},
    },

    // ── No deprecated Node core modules ─────────────────────────────────────
    {
      name: 'no-deprecated-core',
      comment: 'Core may also run in browsers/workers — avoid deprecated Node built-ins.',
      severity: 'warn',
      from: {},
      to: { dependencyTypes: ['core'], path: '^(domain|freelist|smalloc|sys|punycode)$' },
    },
  ],

  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
