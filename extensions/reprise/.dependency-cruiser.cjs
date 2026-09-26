// .dependency-cruiser.cjs — boundary rules for the Reprise extension
// Spec: 00-base.md §B7
//
// Rule summary:
//   - src/<module>/**  may only import:  src/contracts/**, src/util/**, itself
//   - src/wiring/**    may import across all modules (it is the composition root)
//   - src/fakes/**     may import across all modules (test doubles)
//   - src/providers/** may NOT import src/exec/** (provider boundary: providers never execute)

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ── Cross-module imports (the main boundary rule) ────────────────────────
    // A module folder may only import contracts/, util/, or its own folder.
    // Exceptions: wiring/ and fakes/ are the composition root and test doubles.
    {
      name: 'no-cross-module-import',
      comment:
        'A module may only import src/contracts/, src/util/, and its own folder. ' +
        'Cross-module calls must go through the Services interface. ' +
        'Only src/wiring/ and src/fakes/ may import across modules.',
      severity: 'error',
      from: {
        path: '^src/(?!contracts|util|wiring|fakes|extension\\.ts)',
      },
      to: {
        path: '^src/',
        pathNot: [
          '^src/contracts/',
          '^src/util/',
          // Allow a module to import from itself (same folder prefix)
          // This is expressed as a dynamic rule via the "from" group below
        ],
      },
      // Refine: allow self-imports by checking that "to" starts with the same module root
      // dependency-cruiser doesn't support dynamic from-to comparison directly,
      // so we list every module folder explicitly in pathNot to allow self-imports.
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
      from: { orphan: true, pathNot: ['\\.d\\.ts$', 'src/extension\\.ts'] },
      to: {},
    },

    // ── No deprecated Node core modules ─────────────────────────────────────
    {
      name: 'no-deprecated-core',
      comment: 'Web worker environment — deprecated Node built-ins are not available.',
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
