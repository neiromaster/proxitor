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

## Translations

Docs are bilingual. English is the source of truth — the root `README.md` and `docs/configuration.md`. Other languages mirror them:

- `docs/README.<lang>.md` — README in `<lang>`
- `docs/configuration.<lang>.md` — configuration reference in `<lang>`

`<lang>` is an [ISO 639-1](https://en.wikipedia.org/wiki/ISO_639-1) code (`ru`, `de`, `zh`, `fr`, …).

Each localized page opens with a language row: the **current language in bold**, every other available language as a link, using its native name. English comes first, then the rest in a stable order.

```
🌍 **English** · [Русский](./README.ru.md) · [Deutsch](./README.de.md)
```

Configuration reference pages (`docs/configuration.<lang>.md`) keep the row to languages only and link back to their README at the bottom — `← Back to README`.

To add a language:

1. Copy `README.md` → `docs/README.<lang>.md` and `docs/configuration.md` → `docs/configuration.<lang>.md`.
2. Translate them.
3. On **every** localized page, add the new language to the row in the same position, and write the matching row on the new pages (with the new language bolded).