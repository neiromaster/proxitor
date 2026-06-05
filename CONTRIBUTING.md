# Contributing to proxitor

## Setup

```bash
# Requires Node.js 18+ and pnpm
pnpm install
```

Git hooks are installed automatically via [lefthook](https://github.com/evilmartians/lefthook) — they run type checking and biome checks before each commit.

## Development

```bash
pnpm run dev        # watch mode
pnpm run build      # build dist/
pnpm run test       # unit tests
pnpm run test:e2e   # e2e tests (requires OPENROUTER_API_KEY)
pnpm run check      # typecheck + biome + unit tests (run this before opening a PR)
```

## Config for local testing

Copy the example config and fill in your OpenRouter key:

```bash
cp proxitor.config.example.yaml proxitor.config.yaml
# edit proxitor.config.yaml — it's gitignored
```

## Commits

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add per-model timeout override
fix: handle SSE stream disconnect correctly
refactor: extract provider routing logic
docs: update CLI options in README
chore: bump vitest to 3.x
```

## Changesets

If your change affects published behavior (new feature, bug fix, changed config schema), add a changeset:

```bash
pnpm changeset
```

Select the bump type (`patch` for fixes, `minor` for new features, `major` for breaking changes) and write a short description. Commit the generated file along with your changes.

You don't need a changeset for docs, tests, CI, or internal refactors.

## Opening a PR

1. Fork the repo and create a branch from `main`
2. Make your changes, add tests if relevant
3. Run `pnpm run check` — all checks must pass
4. Add a changeset if needed
5. Open a PR and fill in the template

PRs targeting `main` require all CI checks to pass before merging.

## Reporting issues

Please use the issue templates — they help narrow down problems faster, especially for config-related bugs.