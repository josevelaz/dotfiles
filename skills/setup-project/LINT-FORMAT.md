# Lint and formatting policy

Apply this after `install-anti-slop`. The rules below are required setup defaults, including the strict rules and size limits. Merge them with existing configuration; preserve unrelated plugins, rules, overrides, and ignores. Report policy conflicts instead of silently replacing a stronger rule or weakening a check to pass.

## Type-aware linting

Check current Oxlint documentation and package metadata. Install a compatible `oxlint-tsgolint` development dependency through pnpm. Keep the separate project typecheck; type-aware linting does not replace it.

Merge the following into the project's Oxlint configuration. Merge the plugin list rather than replacing it. Keep the generic and Effect JS plugins installed by `install-anti-slop`. For Vite+, use its corresponding lint configuration and verify the installed version's supported options.

```json
{
  "plugins": ["eslint", "typescript", "unicorn"],
  "options": {
    "typeAware": true,
    "reportUnusedDisableDirectives": "error"
  },
  "rules": {
    "typescript/no-explicit-any": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/await-thenable": "error",
    "typescript/switch-exhaustiveness-check": "error",
    "typescript/only-throw-error": "error",
    "typescript/consistent-type-imports": [
      "error",
      { "prefer": "type-imports", "fixStyle": "inline-type-imports" }
    ],
    "typescript/no-unnecessary-condition": "error",
    "typescript/strict-boolean-expressions": "error",
    "typescript/prefer-nullish-coalescing": "error",
    "typescript/prefer-optional-chain": "error",
    "eqeqeq": ["error", "always"],
    "prefer-const": "error",
    "no-duplicate-imports": "error",
    "no-unreachable": "error",
    "no-constant-condition": "error",
    "no-fallthrough": "error",
    "no-unused-vars": [
      "error",
      {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "caughtErrorsIgnorePattern": "^_"
      }
    ],
    "no-nested-ternary": "error",
    "unicorn/no-useless-spread": "error",
    "no-console": "error",
    "unicorn/no-process-exit": "error",
    "complexity": ["error", 5],
    "max-depth": ["error", 3],
    "max-lines-per-function": [
      "error",
      { "max": 75, "skipBlankLines": true, "skipComments": true }
    ],
    "max-lines": [
      "error",
      { "max": 300, "skipBlankLines": true, "skipComments": true }
    ],
    "max-params": ["error", 3],
    "max-statements": ["error", 20],
    "max-nested-callbacks": ["error", 2]
  }
}
```

Apply these rules to owned application, library, test, and script source. Check nested configuration and overrides so they do not silently remove coverage. For monorepos, verify TypeScript project discovery for each package.

Use Effect logging for application diagnostics. If a CLI needs direct user output or an explicit process exit, identify its exact entry-point files and ask approval for a narrow override of `no-console` or `unicorn/no-process-exit`. Keep these rules on in reusable code. Report findings in copied release tooling rather than automatically excluding its whole directory.

Keep the size limits alongside anti-slop's `no-object-parameters` rule. Resolve new-scaffold violations through smaller responsibilities, not dummy wrappers, extra layers, unsafe assertions, or disabled rules. An existing-code cleanup requires a separate request.

## Type guards

This setup deliberately allows runtime `typeof` checks inside explicit type guards. After the generic plugin is configured, set this option in the target project:

```json
{
  "anti-slop/no-runtime-typeof": [
    "error",
    { "allowInTypeGuards": true }
  ]
}
```

This is the setup's explicit override of the installer's bare `"error"` default, not a response to lint failures. Keep the remaining anti-slop rules unchanged. Confirm the installed rule supports the option; report an incompatible plugin instead of silently omitting it. If an existing project deliberately forbids all runtime `typeof` checks, ask before changing that policy.

## Formatting

Preserve an established formatter and its style. For a project without one, use Oxfmt: query its current version, install a compatible development dependency with pnpm, and create its configuration with these defaults:

```json
{
  "printWidth": 80,
  "useTabs": false,
  "tabWidth": 2,
  "singleQuote": false,
  "trailingComma": "all",
  "semi": true,
  "arrowParens": "always"
}
```

Merge formatting ignores for generated files, vendored code, and the agent-tooling paths identified by `install-anti-slop`. Detect local tooling such as `.weave/` and `.intent/`; inspect what they contain before ignoring it. Preserve existing ignores without copying unrelated paths from another repository. Keep owned source checked, including source in dot-directories.

For an existing formatter, map the workflow below to its commands. For Vite+, use its formatter integration and full check rather than adding a second formatter. Align existing editor settings and documentation with the selected formatter; remove stale competing formatter settings only within this setup's scope.

## Validation wiring

For a new standalone Oxlint/Oxfmt project, establish:

```json
{
  "lint": "oxlint --type-aware .",
  "format": "oxfmt --write .",
  "format:check": "oxfmt --check ."
}
```

Merge equivalent commands into existing scripts. Include `lint`, `format:check`, `typecheck`, and existing tests in `validate`, stopping on any failure. CI must run that validation or an equivalent set of checks after a frozen pnpm install. Keep CI and validation read-only; hooks and the explicit `format` command may write formatting changes.

Run lint, format-check, and typecheck separately before the final full validation. Confirm the installed tool accepts every rule and option and performs type-aware analysis. Report unsupported configuration as blocked rather than dropping rules. A successful run on ignored files or an empty source tree does not establish coverage.

Account for every rule above, the type-guard override, formatter choice, ignores, hook integration, CI coverage, and editor alignment in the final report. Distinguish configuration failures from source findings. Record requested boundary overrides by exact file and rule.

## Policy boundaries

Allow simple ternaries and inferred function return types. Preserve the target's filename convention. Blanket bans on `throw`, `try`, or ambient `fetch` require a separate architectural decision; they are not part of these defaults. Keep framework exceptions and project-specific plugins in the project that owns them.
